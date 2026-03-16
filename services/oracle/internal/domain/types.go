package domain

import "github.com/google/uuid"

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
	ID         uuid.UUID
	TargetID   uuid.UUID
	AdvisoryID string
	DiffKind   string
	Channel    string
	Status     string
	Attempts   int
	DedupKey   string
}
