package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"decree/services/oracle/internal/domain"
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

// Type aliases for backward compatibility — canonical definitions are in domain package.
type Target = domain.Target
type Observation = domain.Observation
type DeliveryRecord = domain.DeliveryRecord
