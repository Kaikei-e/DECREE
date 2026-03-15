package notify

import "context"

// Channel sends notifications to an external service.
type Channel interface {
	// Name returns the channel identifier (e.g. "slack", "discord", "webhook").
	Name() string

	// Send delivers a notification message.
	Send(ctx context.Context, msg NotificationMessage) error
}

// NotificationMessage is the payload sent to notification channels.
type NotificationMessage struct {
	TargetName     string   `json:"target_name"`
	AdvisoryID     string   `json:"advisory_id"`
	PackageName    string   `json:"package_name"`
	PackageVersion string   `json:"package_version"`
	Ecosystem      string   `json:"ecosystem"`
	DiffKind       string   `json:"diff_kind"`
	Severity       string   `json:"severity"`
	DecreeScore    *float32 `json:"decree_score,omitempty"`
	PrevScore      *float32 `json:"prev_score,omitempty"`
	EPSSScore      *float32 `json:"epss_score,omitempty"`
	HasExploit     bool     `json:"has_exploit"`
	FixVersions    []string `json:"fix_versions,omitempty"`
}
