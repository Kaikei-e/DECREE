package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// ScanEvent represents a scan-events stream message payload.
type ScanEvent struct {
	Type          string `json:"type"`
	ScanID        string `json:"scan_id"`
	TargetID      string `json:"target_id"`
	FindingsCount int    `json:"findings_count,omitempty"`
	Error         string `json:"error,omitempty"`
}

// EventRouterOption configures the EventRouter.
type EventRouterOption func(*EventRouter)

// WithEventRouterLogger sets a custom logger for the EventRouter.
func WithEventRouterLogger(l *slog.Logger) EventRouterOption {
	return func(r *EventRouter) { r.log = l }
}

// EventRouter dispatches stream events to the diff engine and notification router.
type EventRouter struct {
	detector DiffDetector
	notifier Notifier
	log      *slog.Logger
}

// NewEventRouter creates an EventRouter.
func NewEventRouter(detector DiffDetector, notifier Notifier, opts ...EventRouterOption) *EventRouter {
	r := &EventRouter{
		detector: detector,
		notifier: notifier,
		log:      slog.Default(),
	}
	for _, o := range opts {
		o(r)
	}
	return r
}

// Handle processes a single stream message.
func (r *EventRouter) Handle(ctx context.Context, stream string, msg redis.XMessage) error {
	// Extract payload from message
	payloadStr, ok := msg.Values["payload"].(string)
	if !ok {
		return fmt.Errorf("message %s missing payload field", msg.ID)
	}

	switch stream {
	case "scan-events":
		return r.handleScanEvent(ctx, payloadStr)
	default:
		r.log.DebugContext(ctx, "ignoring message from unknown stream", "stream", stream, "id", msg.ID)
		return nil
	}
}

func (r *EventRouter) handleScanEvent(ctx context.Context, payload string) error {
	var evt ScanEvent
	if err := json.Unmarshal([]byte(payload), &evt); err != nil {
		return fmt.Errorf("unmarshal scan event: %w", err)
	}

	switch evt.Type {
	case "scan.completed":
		return r.handleScanCompleted(ctx, evt)
	case "scan.failed":
		r.log.WarnContext(ctx, "scan failed", "scan_id", evt.ScanID, "target_id", evt.TargetID, "error", evt.Error)
		return nil
	default:
		r.log.DebugContext(ctx, "ignoring unknown scan event type", "type", evt.Type)
		return nil
	}
}

func (r *EventRouter) handleScanCompleted(ctx context.Context, evt ScanEvent) error {
	scanID, err := uuid.Parse(evt.ScanID)
	if err != nil {
		return fmt.Errorf("parse scan_id: %w", err)
	}
	targetID, err := uuid.Parse(evt.TargetID)
	if err != nil {
		return fmt.Errorf("parse target_id: %w", err)
	}

	r.log.InfoContext(ctx, "processing scan completion", "scan_id", scanID, "target_id", targetID,
		"findings", evt.FindingsCount)

	events, err := r.detector.Detect(ctx, scanID, targetID)
	if err != nil {
		return fmt.Errorf("diff detection: %w", err)
	}

	if len(events) == 0 {
		r.log.InfoContext(ctx, "no diff events detected", "scan_id", scanID)
		return nil
	}

	r.log.InfoContext(ctx, "diff events detected", "scan_id", scanID, "count", len(events))

	// Send notifications for diff events
	r.notifier.Notify(ctx, events)

	return nil
}
