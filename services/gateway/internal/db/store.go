package db

import (
	"context"

	"github.com/google/uuid"
)

// Store defines the data access interface for the gateway.
type Store interface {
	ListProjects(ctx context.Context) ([]Project, error)
	ListTargets(ctx context.Context, projectID uuid.UUID) ([]Target, error)
	ListFindings(ctx context.Context, params FindingParams) ([]Finding, bool, error)
	GetFindingDetail(ctx context.Context, instanceID uuid.UUID) (*FindingDetail, error)
	ListTopRisks(ctx context.Context, projectID uuid.UUID, limit int) ([]Finding, error)
	ListTimeline(ctx context.Context, params TimelineParams) ([]TimelineEvent, bool, error)
}
