package scheduler

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/Kaikei-e/decree/services/oracle/internal/config"
	"github.com/Kaikei-e/decree/services/oracle/internal/db"
	"github.com/Kaikei-e/decree/services/oracle/internal/scanner"
)

// Scheduler manages periodic scanning of targets.
type Scheduler struct {
	cfg     *config.Config
	db      *db.DB
	scanner *scanner.Client
	lease   *LeaseManager

	// nextRun tracks when each target is next due for scanning.
	mu      sync.Mutex
	nextRun map[uuid.UUID]time.Time
}

// New creates a Scheduler.
func New(cfg *config.Config, database *db.DB, scannerClient *scanner.Client, leaseMgr *LeaseManager) *Scheduler {
	return &Scheduler{
		cfg:     cfg,
		db:      database,
		scanner: scannerClient,
		lease:   leaseMgr,
		nextRun: make(map[uuid.UUID]time.Time),
	}
}

// Run starts the scheduler loop. It blocks until ctx is cancelled.
func (s *Scheduler) Run(ctx context.Context) error {
	slog.Info("scheduler starting")

	if err := s.seedTargets(ctx); err != nil {
		return err
	}

	targets, err := s.db.ListTargets(ctx)
	if err != nil {
		return err
	}

	// Initial scan if configured
	if s.cfg.Scan.InitialScan {
		slog.Info("running initial scan for all targets", "count", len(targets))
		for _, t := range targets {
			s.triggerScan(ctx, t)
		}
	}

	// Start enrichment refresh goroutine
	go s.runEnrichmentRefresh(ctx)

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
			slog.Info("scheduler stopping")
			return nil
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) tick(ctx context.Context) {
	targets, err := s.db.ListTargets(ctx)
	if err != nil {
		slog.Error("list targets failed", "error", err)
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

func (s *Scheduler) triggerScan(ctx context.Context, target db.Target) {
	interval := s.cfg.Scan.Interval.Duration
	ttl := 2 * interval

	acquired, err := s.lease.Acquire(ctx, target.ID, ttl)
	if err != nil {
		slog.Error("lease acquire failed", "target", target.Name, "error", err)
		return
	}
	if !acquired {
		slog.Debug("lease held by another, skipping", "target", target.Name)
		return
	}

	slog.Info("triggering scan", "target", target.Name, "target_id", target.ID)

	resp, err := s.scanner.RunScan(ctx, target.ID.String())
	if err != nil {
		slog.Error("RunScan failed", "target", target.Name, "error", err)
		s.lease.Release(ctx, target.ID)
		return
	}

	slog.Info("scan started", "target", target.Name, "scan_id", resp.ScanID)

	// Track job for lease
	if jobID, err := uuid.Parse(resp.ScanID); err == nil {
		s.lease.SetJobID(ctx, target.ID, jobID)
	}

	// Poll scan status in background
	go s.pollScanStatus(ctx, target, resp.ScanID)

	// Set next run time
	s.mu.Lock()
	s.nextRun[target.ID] = time.Now().Add(interval)
	s.mu.Unlock()
}

func (s *Scheduler) pollScanStatus(ctx context.Context, target db.Target, scanID string) {
	defer s.lease.Release(ctx, target.ID)

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	timeout := time.After(s.cfg.Scan.Interval.Duration)

	for {
		select {
		case <-ctx.Done():
			return
		case <-timeout:
			slog.Warn("scan poll timeout", "target", target.Name, "scan_id", scanID)
			return
		case <-ticker.C:
			resp, err := s.scanner.GetScanStatus(ctx, scanID)
			if err != nil {
				slog.Error("GetScanStatus failed", "scan_id", scanID, "error", err)
				continue
			}

			switch resp.Status {
			case "completed":
				slog.Info("scan completed", "target", target.Name, "scan_id", scanID)
				return
			case "failed":
				slog.Error("scan failed", "target", target.Name, "scan_id", scanID,
					"error", resp.ErrorMessage)
				return
			default:
				slog.Debug("scan in progress", "target", target.Name, "status", resp.Status)
			}
		}
	}
}

func (s *Scheduler) seedTargets(ctx context.Context) error {
	projectID, err := s.db.EnsureProject(ctx, s.cfg.Project.Name)
	if err != nil {
		return err
	}

	for _, repo := range s.cfg.Targets.Repositories {
		sourceRef := repo.URL
		branch := repo.Branch
		_, err := s.db.UpsertTarget(ctx, projectID, repo.Name, "repository", &sourceRef, &branch)
		if err != nil {
			slog.Error("seed target failed", "name", repo.Name, "error", err)
		}
	}

	for _, ctr := range s.cfg.Targets.Containers {
		image := ctr.Image
		_, err := s.db.UpsertTarget(ctx, projectID, ctr.Name, "container", &image, nil)
		if err != nil {
			slog.Error("seed target failed", "name", ctr.Name, "error", err)
		}
	}

	slog.Info("targets seeded", "project", s.cfg.Project.Name)
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
			slog.Info("refreshing EPSS data")
			if resp, err := s.scanner.SyncEpss(ctx); err != nil {
				slog.Error("EPSS sync failed", "error", err)
			} else {
				slog.Info("EPSS sync complete", "synced", resp.SyncedCount)
				s.recalculateAfterRefresh(ctx)
			}
		case <-nvdTicker.C:
			slog.Info("refreshing NVD data")
			if resp, err := s.scanner.SyncNvd(ctx); err != nil {
				slog.Error("NVD sync failed", "error", err)
			} else {
				slog.Info("NVD sync complete", "synced", resp.SyncedCount)
				s.recalculateAfterRefresh(ctx)
			}
		case <-exploitTicker.C:
			slog.Info("refreshing ExploitDB data")
			if resp, err := s.scanner.SyncExploitDb(ctx); err != nil {
				slog.Error("ExploitDB sync failed", "error", err)
			} else {
				slog.Info("ExploitDB sync complete", "exploits", resp.ExploitsSynced, "links", resp.LinksSynced)
			}
		}
	}
}

func (s *Scheduler) recalculateAfterRefresh(ctx context.Context) {
	resp, err := s.scanner.RecalculateScores(ctx, nil)
	if err != nil {
		slog.Error("score recalculation failed", "error", err)
		return
	}
	slog.Info("scores recalculated", "updated", resp.UpdatedCount)
}
