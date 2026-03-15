package db

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps a pgx connection pool and provides all query methods.
type DB struct {
	Pool *pgxpool.Pool
}

// New creates a DB with the given pool.
func New(pool *pgxpool.Pool) *DB {
	return &DB{Pool: pool}
}

// Connect creates a new connection pool and returns a DB.
func Connect(ctx context.Context, databaseURL string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	cfg.MaxConns = 10
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return &DB{Pool: pool}, nil
}

// Close closes the connection pool.
func (d *DB) Close() {
	d.Pool.Close()
}

// Target represents a scan target from the targets table.
type Target struct {
	ID            uuid.UUID
	ProjectID     uuid.UUID
	Name          string
	TargetType    string
	SourceRef     *string
	Branch        *string
	Subpath       *string
	ExposureClass *string
}

// Observation represents a vulnerability observation for diff detection.
type Observation struct {
	InstanceID     uuid.UUID
	PackageName    string
	PackageVersion string
	Ecosystem      string
	AdvisoryID     string
	CVSSScore      *float32
	EPSSScore      *float32
	DecreeScore    *float32
	Severity       string
	IsDirectDep    *bool
	DepDepth       *int32
}

// DeliveryRecord represents a notification delivery log entry.
type DeliveryRecord struct {
	ID          uuid.UUID
	TargetID    uuid.UUID
	AdvisoryID  string
	DiffKind    string
	Channel     string
	Status      string
	Attempts    int
	DedupKey    string
}
