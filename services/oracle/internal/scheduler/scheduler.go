package scheduler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"

	"decree/services/oracle/internal/config"
	"decree/services/oracle/internal/domain"
)

// SchedulerOption configures the Scheduler.
type SchedulerOption func(*Scheduler)

// WithSchedulerLogger sets a custom logger for the Scheduler.
func WithSchedulerLogger(l *slog.Logger) SchedulerOption {
	return func(s *Scheduler) { s.log = l }
}

// Scheduler manages periodic scanning of targets.
type Scheduler struct {
	cfg     *config.Config
	store   TargetStore
	scanner ScannerService
	lease   *LeaseManager
	log     *slog.Logger

	// nextRun tracks when each target is next due for scanning.
	mu      sync.Mutex
	nextRun map[uuid.UUID]time.Time

	// wg tracks background goroutines (poll, enrichment).
	wg errgroup.Group
}

// New creates a Scheduler.
func New(cfg *config.Config, store TargetStore, scannerSvc ScannerService, leaseMgr *LeaseManager, opts ...SchedulerOption) *Scheduler {
	s := &Scheduler{
		cfg:     cfg,
		store:   store,
		scanner: scannerSvc,
		lease:   leaseMgr,
		log:     slog.Default(),
		nextRun: make(map[uuid.UUID]time.Time),
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Run starts the scheduler loop. It blocks until ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) error {
	s.log.InfoContext(ctx, "scheduler starting")

	// Clean up stale leases from previous instances of this oracle
	if err := s.store.ClearExpiredLeases(ctx); err != nil {
		s.log.ErrorContext(ctx, "failed to clear expired leases", "error", err)
	}

	if err := s.seedTargets(ctx); err != nil {
		return err
	}

	targets, err := s.store.ListTargets(ctx)
	if err != nil {
		return err
	}

	// Initial scan if configured
	if s.cfg.Scan.InitialScan {
		s.log.InfoContext(ctx, "running initial scan for all targets", "count", len(targets))
		for _, t := range targets {
			s.triggerScan(ctx, t)
		}
	}

	// Start enrichment refresh goroutine
	s.wg.Go(func() error {
		s.runEnrichmentRefresh(ctx)
		return nil
	})

	// Main tick loop
	interval := s.cfg.Scan.Interval.Duration
	resolution := interval
	if resolution > 30*time.Second {
		resolution = 30 * time.Second
	}

	ticker := time.NewTicker(resolution)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			s.log.InfoContext(ctx, "scheduler stopping, waiting for background goroutines")
			_ = s.wg.Wait()
			return nil
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	targets, err := s.store.ListTargets(ctx)
	if err != nil {
		s.log.ErrorContext(ctx, "list targets failed", "error", err)
		return
	}

	now := time.Now()
	for _, t := range targets {
		s.mu.Lock()
		nextTime, exists := s.nextRun[t.ID]
		s.mu.Unlock()

		if exists && now.Before(nextTime) {
			continue
		}

		s.triggerScan(ctx, t)
	}
}

func (s *Scheduler) triggerScan(ctx context.Context, target domain.Target) {
	interval := s.cfg.Scan.Interval.Duration
	ttl := 2 * interval

	acquired, err := s.lease.Acquire(ctx, target.ID, ttl)
	if err != nil {
		s.log.ErrorContext(ctx, "lease acquire failed", "target", target.Name, "error", err)
		return
	}
	if !acquired {
		s.log.WarnContext(ctx, "lease held by another, skipping scan", "target", target.Name)
		return
	}

	s.log.InfoContext(ctx, "triggering scan", "target", target.Name, "target_id", target.ID)

	resp, err := s.scanner.RunScan(ctx, target.ID.String())
	if err != nil {
		s.log.ErrorContext(ctx, "RunScan failed", "target", target.Name, "error", err)
		s.lease.Release(ctx, target.ID)
		return
	}

	s.log.InfoContext(ctx, "scan started", "target", target.Name, "scan_id", resp.ScanID)

	// Track job for lease
	if jobID, err := uuid.Parse(resp.ScanID); err == nil {
		s.lease.SetJobID(ctx, target.ID, jobID)
	}

	// Poll scan status in background
	s.wg.Go(func() error {
		s.pollScanStatus(ctx, target, resp.ScanID)
		return nil
	})

	// Set next run time
	s.mu.Lock()
	s.nextRun[target.ID] = time.Now().Add(interval)
	s.mu.Unlock()
}

func (s *Scheduler) pollScanStatus(ctx context.Context, target domain.Target, scanID string) {
	defer s.lease.Release(ctx, target.ID)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	timeout := time.After(s.cfg.Scan.Interval.Duration)

	for {
		select {
		case <-ctx.Done():
			return
		case <-timeout:
			s.log.WarnContext(ctx, "scan poll timeout", "target", target.Name, "scan_id", scanID)
			return
		case <-ticker.C:
			resp, err := s.scanner.GetScanStatus(ctx, scanID)
			if err != nil {
				s.log.ErrorContext(ctx, "GetScanStatus failed", "scan_id", scanID, "error", err)
				continue
			}

			switch resp.Status {
			case "completed":
				s.log.InfoContext(ctx, "scan completed", "target", target.Name, "scan_id", scanID)
				return
			case "failed":
				s.log.ErrorContext(ctx, "scan failed", "target", target.Name, "scan_id", scanID,
					"error", resp.ErrorMessage)
				return
			default:
				s.log.DebugContext(ctx, "scan in progress", "target", target.Name, "status", resp.Status)
			}
		}
	}
}

func (s *Scheduler) seedTargets(ctx context.Context) error {
	projectID, err := s.store.EnsureProject(ctx, s.cfg.Project.Name)
	if err != nil {
		return err
	}

	var errs []error

	for _, repo := range s.cfg.Targets.Repositories {
		sourceRef := repo.URL
		branch := repo.Branch
		_, err := s.store.UpsertTarget(ctx, projectID, repo.Name, "repository", &sourceRef, &branch)
		if err != nil {
			errs = append(errs, err)
		}
	}

	for _, ctr := range s.cfg.Targets.Containers {
		image := ctr.Image
		_, err := s.store.UpsertTarget(ctx, projectID, ctr.Name, "container", &image, nil)
		if err != nil {
			errs = append(errs, err)
		}
	}

	if err := errors.Join(errs...); err != nil {
		return fmt.Errorf("seed targets: %w", err)
	}

	s.log.InfoContext(ctx, "targets seeded", "project", s.cfg.Project.Name)
	return nil
}

func (s *Scheduler) runEnrichmentRefresh(ctx context.Context) {
	epssInterval := s.cfg.Scan.VulnerabilityRefresh.EPSS.Duration
	nvdInterval := s.cfg.Scan.VulnerabilityRefresh.NVD.Duration

	if epssInterval == 0 {
		epssInterval = 24 * time.Hour
	}
	if nvdInterval == 0 {
		nvdInterval = 6 * time.Hour
	}

	epssTicker := time.NewTicker(epssInterval)
	nvdTicker := time.NewTicker(nvdInterval)
	exploitTicker := time.NewTicker(nvdInterval) // same cadence as NVD
	defer epssTicker.Stop()
	defer nvdTicker.Stop()
	defer exploitTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-epssTicker.C:
			s.log.InfoContext(ctx, "refreshing EPSS data")
			if resp, err := s.scanner.SyncEpss(ctx); err != nil {
				s.log.ErrorContext(ctx, "EPSS sync failed", "error", err)
			} else {
				s.log.InfoContext(ctx, "EPSS sync complete", "synced", resp.SyncedCount)
				s.recalculateAfterRefresh(ctx)
			}
		case <-nvdTicker.C:
			s.log.InfoContext(ctx, "refreshing NVD data")
			if resp, err := s.scanner.SyncNvd(ctx); err != nil {
				s.log.ErrorContext(ctx, "NVD sync failed", "error", err)
			} else {
				s.log.InfoContext(ctx, "NVD sync complete", "synced", resp.SyncedCount)
				s.recalculateAfterRefresh(ctx)
			}
		case <-exploitTicker.C:
			s.log.InfoContext(ctx, "refreshing ExploitDB data")
			if resp, err := s.scanner.SyncExploitDb(ctx); err != nil {
				s.log.ErrorContext(ctx, "ExploitDB sync failed", "error", err)
			} else {
				s.log.InfoContext(ctx, "ExploitDB sync complete", "exploits", resp.ExploitsSynced, "links", resp.LinksSynced)
			}
		}
	}
}

func (s *Scheduler) recalculateAfterRefresh(ctx context.Context) {
	resp, err := s.scanner.RecalculateScores(ctx, nil)
	if err != nil {
		s.log.ErrorContext(ctx, "score recalculation failed", "error", err)
		return
	}
	s.log.InfoContext(ctx, "scores recalculated", "updated", resp.UpdatedCount)
}
