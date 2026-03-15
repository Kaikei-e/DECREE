package diff

import (
	"context"
	"log/slog"
	"math"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"decree/services/oracle/internal/db"
)

// Engine detects differences between consecutive scans using fact tables only.
type Engine struct {
	db *db.DB
}

// NewEngine creates a diff engine.
func NewEngine(database *db.DB) *Engine {
	return &Engine{db: database}
}

// Detect compares the current scan against the previous completed scan
// and returns diff events. It reads only from fact tables.
func (e *Engine) Detect(ctx context.Context, scanID, targetID uuid.UUID) ([]DiffEvent, error) {
	targetName, err := e.db.GetTargetName(ctx, targetID)
	if err != nil {
		return nil, err
	}

	// Get current observations
	current, err := e.db.GetCurrentObservations(ctx, scanID)
	if err != nil {
		return nil, err
	}

	// Get previous scan
	prevScanID, err := e.db.GetPreviousCompletedScanID(ctx, targetID, scanID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// First scan — everything is new
			slog.Info("first scan for target, all findings are new",
				"target", targetName, "findings", len(current))
			return e.allAsNew(ctx, current, scanID, targetID, targetName)
		}
		return nil, err
	}

	// Get previous observations
	previous, err := e.db.GetCurrentObservations(ctx, prevScanID)
	if err != nil {
		return nil, err
	}

	// Build index maps by instance_id
	currentMap := indexByInstance(current)
	previousMap := indexByInstance(previous)

	// Collect CVE IDs for exploit check
	var cveIDs []string
	for _, obs := range current {
		cveIDs = append(cveIDs, obs.AdvisoryID)
	}

	currentExploits, err := e.db.GetExploitLinkedCVEs(ctx, cveIDs)
	if err != nil {
		return nil, err
	}

	// Also check what exploits existed before
	var prevCVEIDs []string
	for _, obs := range previous {
		prevCVEIDs = append(prevCVEIDs, obs.AdvisoryID)
	}
	prevExploits, err := e.db.GetExploitLinkedCVEs(ctx, prevCVEIDs)
	if err != nil {
		return nil, err
	}

	var events []DiffEvent

	// new_cve: in current but not in previous
	for id, obs := range currentMap {
		if _, existed := previousMap[id]; !existed {
			evt := buildEvent(DiffNewCVE, scanID, targetID, targetName, obs, currentExploits)
			events = append(events, evt)
		}
	}

	// resolved_cve: in previous but not in current
	for id, obs := range previousMap {
		if _, exists := currentMap[id]; !exists {
			evt := buildEvent(DiffResolvedCVE, scanID, targetID, targetName, obs, nil)
			// Record disappearance
			if err := e.db.InsertDisappearance(ctx, id, scanID); err != nil {
				slog.Error("insert disappearance failed", "instance_id", id, "error", err)
			}
			events = append(events, evt)
		}
	}

	// score_change + new_exploit: in both, check score diff and exploit status
	for id, curr := range currentMap {
		prev, existed := previousMap[id]
		if !existed {
			continue
		}

		// Check score change (|delta| > 0.5)
		if curr.DecreeScore != nil && prev.DecreeScore != nil {
			delta := math.Abs(float64(*curr.DecreeScore - *prev.DecreeScore))
			if delta > 0.5 {
				evt := buildEvent(DiffScoreChange, scanID, targetID, targetName, curr, currentExploits)
				evt.PrevScore = prev.DecreeScore
				events = append(events, evt)
			}
		}

		// Check new exploit
		if currentExploits[curr.AdvisoryID] && !prevExploits[curr.AdvisoryID] {
			evt := buildEvent(DiffNewExploit, scanID, targetID, targetName, curr, currentExploits)
			events = append(events, evt)
		}
	}

	// Insert outbox events for each diff
	for _, evt := range events {
		payload := map[string]any{
			"type":            "finding." + string(evt.Kind),
			"target_id":       evt.TargetID.String(),
			"scan_id":         evt.ScanID.String(),
			"advisory_id":     evt.AdvisoryID,
			"package_name":    evt.PackageName,
			"severity":        evt.Severity,
			"decree_score":    evt.DecreeScore,
			"has_exploit":     evt.HasExploit,
		}
		if err := e.db.InsertOutboxEvent(ctx, "finding-events", payload); err != nil {
			slog.Error("insert outbox event failed", "error", err)
		}
	}

	// Enrich with fix versions
	for i := range events {
		versions, err := e.db.GetFixVersions(ctx, events[i].InstanceID)
		if err != nil {
			slog.Error("get fix versions failed", "instance_id", events[i].InstanceID, "error", err)
			continue
		}
		events[i].FixVersions = versions
	}

	return events, nil
}

func (e *Engine) allAsNew(ctx context.Context, observations []db.Observation, scanID, targetID uuid.UUID, targetName string) ([]DiffEvent, error) {
	var cveIDs []string
	for _, obs := range observations {
		cveIDs = append(cveIDs, obs.AdvisoryID)
	}
	exploits, err := e.db.GetExploitLinkedCVEs(ctx, cveIDs)
	if err != nil {
		return nil, err
	}

	events := make([]DiffEvent, 0, len(observations))
	for _, obs := range observations {
		evt := buildEvent(DiffNewCVE, scanID, targetID, targetName, obs, exploits)
		events = append(events, evt)
	}

	// Enrich with fix versions
	for i := range events {
		versions, err := e.db.GetFixVersions(ctx, events[i].InstanceID)
		if err != nil {
			slog.Error("get fix versions failed", "instance_id", events[i].InstanceID, "error", err)
			continue
		}
		events[i].FixVersions = versions
	}

	return events, nil
}

func indexByInstance(obs []db.Observation) map[uuid.UUID]db.Observation {
	m := make(map[uuid.UUID]db.Observation, len(obs))
	for _, o := range obs {
		m[o.InstanceID] = o
	}
	return m
}

func buildEvent(kind DiffKind, scanID, targetID uuid.UUID, targetName string, obs db.Observation, exploits map[string]bool) DiffEvent {
	return DiffEvent{
		Kind:           kind,
		TargetID:       targetID,
		TargetName:     targetName,
		ScanID:         scanID,
		InstanceID:     obs.InstanceID,
		AdvisoryID:     obs.AdvisoryID,
		PackageName:    obs.PackageName,
		PackageVersion: obs.PackageVersion,
		Ecosystem:      obs.Ecosystem,
		Severity:       obs.Severity,
		DecreeScore:    obs.DecreeScore,
		EPSSScore:      obs.EPSSScore,
		HasExploit:     exploits[obs.AdvisoryID],
	}
}
