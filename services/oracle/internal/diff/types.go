package diff

import "github.com/google/uuid"

// DiffKind represents the type of change detected.
type DiffKind string

const (
	DiffNewCVE      DiffKind = "new_cve"
	DiffResolvedCVE DiffKind = "resolved_cve"
	DiffScoreChange DiffKind = "score_change"
	DiffNewExploit  DiffKind = "new_exploit"
)

// DiffEvent represents a detected difference between scans.
type DiffEvent struct {
	Kind           DiffKind  `json:"kind"`
	TargetID       uuid.UUID `json:"target_id"`
	TargetName     string    `json:"target_name"`
	ScanID         uuid.UUID `json:"scan_id"`
	InstanceID     uuid.UUID `json:"instance_id"`
	AdvisoryID     string    `json:"advisory_id"`
	PackageName    string    `json:"package_name"`
	PackageVersion string    `json:"package_version"`
	Ecosystem      string    `json:"ecosystem"`
	Severity       string    `json:"severity"`
	DecreeScore    *float32  `json:"decree_score,omitempty"`
	PrevScore      *float32  `json:"prev_score,omitempty"`
	EPSSScore      *float32  `json:"epss_score,omitempty"`
	HasExploit     bool      `json:"has_exploit"`
	FixVersions    []string  `json:"fix_versions,omitempty"`
}

// SeverityOrder returns numeric priority for severity (higher = more severe).
func SeverityOrder(severity string) int {
	switch severity {
	case "critical":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}
