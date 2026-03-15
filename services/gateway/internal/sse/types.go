package sse

// Event represents a Server-Sent Event.
type Event struct {
	ID        string // Redis message ID → Last-Event-ID
	Type      string // finding_changed, notification_sent, ...
	ProjectID string // Optional project scope for per-project subscribers
	Data      string // JSON payload
}
