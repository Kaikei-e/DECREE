package diff

import (
	"context"

	"github.com/google/uuid"

	"decree/services/oracle/internal/domain"
)

// ObservationReader provides read access to vulnerability observations and related data.
type ObservationReader interface {
	GetTargetName(ctx context.Context, targetID uuid.UUID) (string, error)
	GetTargetProjectID(ctx context.Context, targetID uuid.UUID) (uuid.UUID, error)
	GetCurrentObservations(ctx context.Context, scanID uuid.UUID) ([]domain.Observation, error)
	GetPreviousCompletedScanID(ctx context.Context, targetID, currentScanID uuid.UUID) (uuid.UUID, error)
	GetExploitLinkedCVEs(ctx context.Context, cveIDs []string) (map[string]bool, error)
	GetFixVersions(ctx context.Context, instanceID uuid.UUID) ([]string, error)
	ResolveFinding(ctx context.Context, instanceID, scanID uuid.UUID) error
	InsertOutboxEvent(ctx context.Context, streamName string, payload any) error
}
