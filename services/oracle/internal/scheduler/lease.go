package scheduler

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"

	"decree/services/oracle/internal/db"
)

// LeaseManager manages per-target exclusive job leases.
type LeaseManager struct {
	db       *db.DB
	holderID string
}

// NewLeaseManager creates a LeaseManager with a unique holder ID.
func NewLeaseManager(database *db.DB) *LeaseManager {
	hostname, _ := os.Hostname()
	holderID := fmt.Sprintf("oracle-%s-%d", hostname, os.Getpid())
	return &LeaseManager{db: database, holderID: holderID}
}

// HolderID returns this lease manager's holder ID.
func (lm *LeaseManager) HolderID() string {
	return lm.holderID
}

// Acquire attempts to acquire a lease for the given target.
// TTL should be 2x the scan interval.
func (lm *LeaseManager) Acquire(ctx context.Context, targetID uuid.UUID, ttl time.Duration) (bool, error) {
	if lm.db == nil {
		return true, nil
	}
	return lm.db.AcquireLease(ctx, targetID, lm.holderID, ttl)
}

// Release releases the lease for the given target.
func (lm *LeaseManager) Release(ctx context.Context, targetID uuid.UUID) error {
	if lm.db == nil {
		return nil
	}
	return lm.db.ReleaseLease(ctx, targetID, lm.holderID)
}

// SetJobID associates a job ID with a lease.
func (lm *LeaseManager) SetJobID(ctx context.Context, targetID uuid.UUID, jobID uuid.UUID) error {
	if lm.db == nil {
		return nil
	}
	return lm.db.UpdateLeaseJobID(ctx, targetID, jobID)
}
