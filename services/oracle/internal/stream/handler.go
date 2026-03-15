package stream

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"decree/services/oracle/internal/diff"
	"decree/services/oracle/internal/notify"
)

// ScanEvent represents a scan-events stream message payload.
type ScanEvent struct {
	Type          string `json:"type"`
	ScanID        string `json:"scan_id"`
	TargetID      string `json:"target_id"`
	FindingsCount int    `json:"findings_count,omitempty"`
	Error         string `json:"error,omitempty"`
}

// EventRouter dispatches stream events to the diff engine and notification router.
type EventRouter struct {
	diffEngine *diff.Engine
	notifier   *notify.Router
}

// NewEventRouter creates an EventRouter.
func NewEventRouter(diffEngine *diff.Engine, notifier *notify.Router) *EventRouter {
	return &EventRouter{
		diffEngine: diffEngine,
		notifier:   notifier,
	}
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
		slog.Debug("ignoring message from unknown stream", "stream", stream, "id", msg.ID)
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
		slog.Warn("scan failed", "scan_id", evt.ScanID, "target_id", evt.TargetID, "error", evt.Error)
		return nil
	default:
		slog.Debug("ignoring unknown scan event type", "type", evt.Type)
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

	slog.Info("processing scan completion", "scan_id", scanID, "target_id", targetID,
		"findings", evt.FindingsCount)

	events, err := r.diffEngine.Detect(ctx, scanID, targetID)
	if err != nil {
		return fmt.Errorf("diff detection: %w", err)
	}

	if len(events) == 0 {
		slog.Info("no diff events detected", "scan_id", scanID)
		return nil
	}

	slog.Info("diff events detected", "scan_id", scanID, "count", len(events))

	// Send notifications for diff events
	r.notifier.Notify(ctx, events)

	return nil
}
