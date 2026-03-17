package db

import (
	"time"

	"github.com/google/uuid"
)

type Project struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

type Target struct {
	ID            uuid.UUID `json:"id"`
	ProjectID     uuid.UUID `json:"project_id"`
	Name          string    `json:"name"`
	TargetType    string    `json:"target_type"`
	SourceRef     *string   `json:"source_ref,omitempty"`
	Branch        *string   `json:"branch,omitempty"`
	Subpath       *string   `json:"subpath,omitempty"`
	ExposureClass *string   `json:"exposure_class,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

type Finding struct {
	InstanceID     uuid.UUID  `json:"instance_id"`
	TargetID       uuid.UUID  `json:"target_id"`
	TargetName     string     `json:"target_name"`
	PackageName    string     `json:"package_name"`
	PackageVersion string     `json:"package_version"`
	Ecosystem      string     `json:"ecosystem"`
	AdvisoryID     string     `json:"advisory_id"`
	Severity       *string    `json:"severity,omitempty"`
	DecreeScore    *float32   `json:"decree_score,omitempty"`
	EPSSScore      *float32   `json:"epss_score,omitempty"`
	CVSSScore      *float32   `json:"cvss_score,omitempty"`
	IsActive       bool       `json:"is_active"`
	LastObservedAt *time.Time `json:"last_observed_at,omitempty"`
}

type FindingParams struct {
	ProjectID  uuid.UUID
	Severity   *string
	Ecosystem  *string
	MinEPSS    *float32
	ActiveOnly bool
	Cursor     *FindingCursor
	Limit      int
}

type FindingCursor struct {
	Score      float32
	InstanceID uuid.UUID
}

type FindingDetail struct {
	Finding
	AdvisorySource    string             `json:"advisory_source"`
	DetectionEvidence *DetectionEvidence `json:"detection_evidence,omitempty"`
	CVSSVector        *string            `json:"cvss_vector,omitempty"`
	Reachability      *float32           `json:"reachability,omitempty"`
	IsDirectDep       *bool              `json:"is_direct_dep,omitempty"`
	DepDepth          *int32             `json:"dep_depth,omitempty"`
	ExposureClass     *string            `json:"exposure_class,omitempty"`
	FixVersions       []string           `json:"fix_versions"`
	Exploits          []ExploitRef       `json:"exploits"`
	DependencyPath    []DependencyEdge   `json:"dependency_path"`
}

type DetectionEvidence struct {
	Source                string     `json:"source"`
	FetchedAt             *time.Time `json:"fetched_at,omitempty"`
	Summary               *string    `json:"summary,omitempty"`
	Aliases               []string   `json:"aliases"`
	RangeEvaluationStatus string     `json:"range_evaluation_status"`
}

type ExploitRef struct {
	Source      string     `json:"source"`
	SourceID    string     `json:"source_id"`
	Title       *string    `json:"title,omitempty"`
	URL         *string    `json:"url,omitempty"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
}

type DependencyEdge struct {
	FromPkg string `json:"from_pkg"`
	ToPkg   string `json:"to_pkg"`
	DepType string `json:"dep_type"`
}

type TimelineEvent struct {
	ID         uuid.UUID `json:"id"`
	InstanceID uuid.UUID `json:"instance_id"`
	ScanID     uuid.UUID `json:"scan_id"`
	EventType  string    `json:"event_type"`
	OccurredAt time.Time `json:"occurred_at"`
	// Observation-specific fields
	AdvisoryID  *string  `json:"advisory_id,omitempty"`
	PackageName *string  `json:"package_name,omitempty"`
	Severity    *string  `json:"severity,omitempty"`
	DecreeScore *float32 `json:"decree_score,omitempty"`
}

type TimelineParams struct {
	ProjectID uuid.UUID
	TargetID  *uuid.UUID
	EventType *string
	From      *time.Time
	To        *time.Time
	Cursor    *TimelineCursor
	Limit     int
}

type TimelineCursor struct {
	OccurredAt time.Time
	ID         uuid.UUID
}
