package stream

import (
	"context"

	"github.com/google/uuid"

	"decree/services/oracle/internal/diff"
)

// DiffDetector detects differences between consecutive scans.
type DiffDetector interface {
	Detect(ctx context.Context, scanID, targetID uuid.UUID) ([]diff.DiffEvent, error)
}

// Notifier sends notifications for diff events.
type Notifier interface {
	Notify(ctx context.Context, events []diff.DiffEvent)
}
