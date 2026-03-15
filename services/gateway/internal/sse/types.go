package sse

// Event represents a Server-Sent Event.
type Event struct {
	ID   string // Redis message ID → Last-Event-ID
	Type string // scan_completed, finding_changed, top_risk_changed, notification_sent
	Data string // JSON payload
}
