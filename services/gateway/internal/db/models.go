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

// FindingFilters narrows the instance set. Both the findings list and the
// advisory grouping apply it to the same relation, so grouped counts always
// describe exactly the rows the findings list would return.
type FindingFilters struct {
	ProjectID  uuid.UUID
	Severity   *string
	Ecosystem  *string
	MinEPSS    *float32
	MinScore   *float32
	Advisory   *string
	Query      *string
	ActiveOnly bool
}

type FindingParams struct {
	FindingFilters
	Sort     SortKey
	SortDesc bool
	Cursor   *FindingCursor
	Limit    int
}

type FindingCursor struct {
	Sort       SortKey
	Desc       bool
	Value      any
	InstanceID uuid.UUID
}

// AdvisoryGroup collapses every instance of one advisory into a single row.
// The name lists are capped at AdvisoryNameCap; the counts are not, so the UI
// can render the remainder as "+N more".
type AdvisoryGroup struct {
	AdvisoryID      string     `json:"advisory_id"`
	Severity        *string    `json:"severity,omitempty"`
	MaxDecreeScore  *float32   `json:"max_decree_score,omitempty"`
	EPSSScore       *float32   `json:"epss_score,omitempty"`
	CVSSScore       *float32   `json:"cvss_score,omitempty"`
	InstanceCount   int64      `json:"instance_count"`
	TargetCount     int64      `json:"target_count"`
	TargetNames     []string   `json:"target_names"`
	PackageNames    []string   `json:"package_names"`
	Ecosystems      []string   `json:"ecosystems"`
	IsActive        bool       `json:"is_active"`
	FirstObservedAt *time.Time `json:"first_observed_at,omitempty"`
	LastObservedAt  *time.Time `json:"last_observed_at,omitempty"`
}

type AdvisoryParams struct {
	FindingFilters
	Sort     SortKey
	SortDesc bool
	Cursor   *AdvisoryCursor
	Limit    int
}

type AdvisoryCursor struct {
	Sort       SortKey
	Desc       bool
	Value      any
	AdvisoryID string
}

// Facets are the filter options for a project, computed independently of the
// caller's current severity/ecosystem/search filters.
type Facets struct {
	Ecosystems     []string       `json:"ecosystems"`
	SeverityCounts map[string]int `json:"severity_counts"`
	Total          int            `json:"total"`
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
