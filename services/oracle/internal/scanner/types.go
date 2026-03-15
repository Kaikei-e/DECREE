package scanner

// Request/response types matching proto/scanner/v1/scanner.proto.
// Used directly for Connect-RPC JSON encoding.

type RunScanRequest struct {
	TargetID string `json:"target_id,omitempty"`
}

type RunScanResponse struct {
	ScanID string `json:"scan_id,omitempty"`
	Status string `json:"status,omitempty"`
}

type GetScanStatusRequest struct {
	ScanID string `json:"scan_id,omitempty"`
}

type GetScanStatusResponse struct {
	ScanID       string `json:"scan_id,omitempty"`
	Status       string `json:"status,omitempty"`
	StartedAt    string `json:"started_at,omitempty"`
	CompletedAt  string `json:"completed_at,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
}

type SyncEpssRequest struct{}
type SyncEpssResponse struct {
	SyncedCount uint32 `json:"synced_count,omitempty"`
}

type SyncNvdRequest struct{}
type SyncNvdResponse struct {
	SyncedCount uint32 `json:"synced_count,omitempty"`
}

type SyncExploitDbRequest struct{}
type SyncExploitDbResponse struct {
	ExploitsSynced uint32 `json:"exploits_synced,omitempty"`
	LinksSynced    uint32 `json:"links_synced,omitempty"`
}

type RecalculateScoresRequest struct {
	CVEIDs []string `json:"cve_ids,omitempty"`
}

type RecalculateScoresResponse struct {
	UpdatedCount uint32 `json:"updated_count,omitempty"`
}
