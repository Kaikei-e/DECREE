package scanner

// Request/response types matching proto/scanner/v1/scanner.proto.
// JSON tags use camelCase to match Connect-RPC/pbjson convention.

type RunScanRequest struct {
	TargetID string `json:"targetId,omitempty"`
}

type RunScanResponse struct {
	ScanID string `json:"scanId,omitempty"`
	Status string `json:"status,omitempty"`
}

type GetScanStatusRequest struct {
	ScanID string `json:"scanId,omitempty"`
}

type GetScanStatusResponse struct {
	ScanID       string `json:"scanId,omitempty"`
	Status       string `json:"status,omitempty"`
	StartedAt    string `json:"startedAt,omitempty"`
	CompletedAt  string `json:"completedAt,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

type SyncEpssRequest struct{}
type SyncEpssResponse struct {
	SyncedCount uint32 `json:"syncedCount,omitempty"`
}

type SyncNvdRequest struct{}
type SyncNvdResponse struct {
	SyncedCount uint32 `json:"syncedCount,omitempty"`
}

type SyncExploitDbRequest struct{}
type SyncExploitDbResponse struct {
	ExploitsSynced uint32 `json:"exploitsSynced,omitempty"`
	LinksSynced    uint32 `json:"linksSynced,omitempty"`
}

type RecalculateScoresRequest struct {
	CVEIDs []string `json:"cveIds,omitempty"`
}

type RecalculateScoresResponse struct {
	UpdatedCount uint32 `json:"updatedCount,omitempty"`
}
