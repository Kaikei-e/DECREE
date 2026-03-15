package sse

import (
	"log/slog"
	"sync"
	"sync/atomic"
)

const clientBufferSize = 64

// Broker manages SSE client connections and broadcasts events.
type Broker struct {
	mu      sync.RWMutex
	clients map[uint64]chan Event
	nextID  atomic.Uint64
}

func NewBroker() *Broker {
	return &Broker{
		clients: make(map[uint64]chan Event),
	}
}

// Register adds a new client and returns its ID and event channel.
func (b *Broker) Register() (uint64, <-chan Event) {
	id := b.nextID.Add(1)
	ch := make(chan Event, clientBufferSize)

	b.mu.Lock()
	b.clients[id] = ch
	b.mu.Unlock()

	slog.Info("sse client registered", "client_id", id)
	return id, ch
}

// Unregister removes a client and closes its channel.
func (b *Broker) Unregister(id uint64) {
	b.mu.Lock()
	ch, ok := b.clients[id]
	if ok {
		delete(b.clients, id)
		close(ch)
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

	for id, ch := range b.clients {
		select {
		case ch <- event:
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
