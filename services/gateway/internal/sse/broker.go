package sse

import (
	"errors"
	"log/slog"
	"sync"
	"sync/atomic"
)

const clientBufferSize = 64

// MaxSSEClients is the maximum number of concurrent SSE connections.
const MaxSSEClients = 256

// ErrTooManyClients is returned when the SSE client limit is reached.
var ErrTooManyClients = errors.New("too many SSE clients")

// Broker manages SSE client connections and broadcasts events.
type Broker struct {
	mu      sync.RWMutex
	clients map[uint64]clientSubscription
	nextID  atomic.Uint64
}

type clientSubscription struct {
	projectID string
	ch        chan Event
}

func NewBroker() *Broker {
	return &Broker{
		clients: make(map[uint64]clientSubscription),
	}
}

// Register adds a new client and returns its ID and event channel.
// Returns ErrTooManyClients if the maximum number of connections is reached.
func (b *Broker) Register(projectID string) (uint64, <-chan Event, error) {
	b.mu.Lock()
	if len(b.clients) >= MaxSSEClients {
		b.mu.Unlock()
		slog.Warn("sse client rejected: max clients reached", "max", MaxSSEClients)
		return 0, nil, ErrTooManyClients
	}

	id := b.nextID.Add(1)
	ch := make(chan Event, clientBufferSize)
	b.clients[id] = clientSubscription{
		projectID: projectID,
		ch:        ch,
	}
	b.mu.Unlock()

	slog.Info("sse client registered", "client_id", id, "project_id", projectID)
	return id, ch, nil
}

// Unregister removes a client and closes its channel.
func (b *Broker) Unregister(id uint64) {
	b.mu.Lock()
	sub, ok := b.clients[id]
	if ok {
		delete(b.clients, id)
		close(sub.ch)
	}
	b.mu.Unlock()

	if ok {
		slog.Info("sse client unregistered", "client_id", id)
	}
}

// Broadcast sends an event to all connected clients.
// Full channels are skipped (backpressure: drop + log).
func (b *Broker) Broadcast(event Event) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for id, sub := range b.clients {
		if sub.projectID != "" && event.ProjectID != "" && sub.projectID != event.ProjectID {
			continue
		}
		select {
		case sub.ch <- event:
		default:
			slog.Warn("sse client buffer full, dropping event", "client_id", id, "event_type", event.Type)
		}
	}
}

// ClientCount returns the number of connected clients.
func (b *Broker) ClientCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients)
}
