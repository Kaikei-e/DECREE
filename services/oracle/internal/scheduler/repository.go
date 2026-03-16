package scheduler

import (
	"context"

	"github.com/google/uuid"

	"decree/services/oracle/internal/domain"
	"decree/services/oracle/internal/scanner"
)

// TargetStore provides access to target and project data.
type TargetStore interface {
	ListTargets(ctx context.Context) ([]domain.Target, error)
	UpsertTarget(ctx context.Context, projectID uuid.UUID, name, targetType string, sourceRef, branch *string) (uuid.UUID, error)
	EnsureProject(ctx context.Context, name string) (uuid.UUID, error)
	ClearExpiredLeases(ctx context.Context) error
}

// ScannerService provides access to scanner operations.
type ScannerService interface {
	RunScan(ctx context.Context, targetID string) (*scanner.RunScanResponse, error)
	GetScanStatus(ctx context.Context, scanID string) (*scanner.GetScanStatusResponse, error)
	SyncEpss(ctx context.Context) (*scanner.SyncEpssResponse, error)
	SyncNvd(ctx context.Context) (*scanner.SyncNvdResponse, error)
	SyncExploitDb(ctx context.Context) (*scanner.SyncExploitDbResponse, error)
	RecalculateScores(ctx context.Context, cveIDs []string) (*scanner.RecalculateScoresResponse, error)
}
