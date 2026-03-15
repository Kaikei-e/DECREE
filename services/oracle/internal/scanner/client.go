package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

// Client calls the scanner Connect-RPC endpoints.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a scanner client pointing at the given base URL.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Minute,
		},
	}
}

// RunScan triggers a scan for the given target.
func (c *Client) RunScan(ctx context.Context, targetID string) (*RunScanResponse, error) {
	req := RunScanRequest{TargetID: targetID}
	var resp RunScanResponse
	err := c.call(ctx, "/scanner.v1.ScannerService/RunScan", req, &resp, 5*time.Minute)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// GetScanStatus returns the status of a scan job.
func (c *Client) GetScanStatus(ctx context.Context, scanID string) (*GetScanStatusResponse, error) {
	req := GetScanStatusRequest{ScanID: scanID}
	var resp GetScanStatusResponse
	err := c.call(ctx, "/scanner.v1.ScannerService/GetScanStatus", req, &resp, 30*time.Second)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}

// SyncEpss triggers EPSS data sync.
func (c *Client) SyncEpss(ctx context.Context) (*SyncEpssResponse, error) {
	var resp SyncEpssResponse
	err := c.call(ctx, "/scanner.v1.EnrichmentService/SyncEpss", SyncEpssRequest{}, &resp, 10*time.Minute)
	return &resp, err
}

// SyncNvd triggers NVD data sync.
func (c *Client) SyncNvd(ctx context.Context) (*SyncNvdResponse, error) {
	var resp SyncNvdResponse
	err := c.call(ctx, "/scanner.v1.EnrichmentService/SyncNvd", SyncNvdRequest{}, &resp, 10*time.Minute)
	return &resp, err
}

// SyncExploitDb triggers ExploitDB sync.
func (c *Client) SyncExploitDb(ctx context.Context) (*SyncExploitDbResponse, error) {
	var resp SyncExploitDbResponse
	err := c.call(ctx, "/scanner.v1.EnrichmentService/SyncExploitDb", SyncExploitDbRequest{}, &resp, 10*time.Minute)
	return &resp, err
}

// RecalculateScores triggers score recalculation.
func (c *Client) RecalculateScores(ctx context.Context, cveIDs []string) (*RecalculateScoresResponse, error) {
	req := RecalculateScoresRequest{CVEIDs: cveIDs}
	var resp RecalculateScoresResponse
	err := c.call(ctx, "/scanner.v1.EnrichmentService/RecalculateScores", req, &resp, 10*time.Minute)
	return &resp, err
}

// ConnectError represents a Connect-RPC error response.
type ConnectError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *ConnectError) Error() string {
	return fmt.Sprintf("connect error %s: %s", e.Code, e.Message)
}

// call makes a Connect-RPC unary call with retry.
func (c *Client) call(ctx context.Context, path string, reqBody, respBody any, timeout time.Duration) error {
	backoffs := []time.Duration{1 * time.Second, 5 * time.Second, 30 * time.Second}

	var lastErr error
	for attempt := range len(backoffs) + 1 {
		err := c.doCall(ctx, path, reqBody, respBody, timeout)
		if err == nil {
			return nil
		}
		lastErr = err

		// Only retry on unavailable/deadline errors
		if !isRetryable(err) {
			return err
		}

		if attempt < len(backoffs) {
			slog.Warn("scanner call failed, retrying",
				"path", path, "attempt", attempt+1, "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoffs[attempt]):
			}
		}
	}
	return lastErr
}

func (c *Client) doCall(ctx context.Context, path string, reqBody, respBody any, timeout time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	body, err := json.Marshal(reqBody)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("http call %s: %w", path, err)
	}
	defer httpResp.Body.Close()

	respData, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if httpResp.StatusCode != http.StatusOK {
		var ce ConnectError
		if json.Unmarshal(respData, &ce) == nil && ce.Code != "" {
			return &ce
		}
		return fmt.Errorf("scanner %s returned %d: %s", path, httpResp.StatusCode, string(respData))
	}

	if err := json.Unmarshal(respData, respBody); err != nil {
		return fmt.Errorf("unmarshal response: %w", err)
	}
	return nil
}

func isRetryable(err error) bool {
	ce, ok := err.(*ConnectError)
	if !ok {
		return true // network errors are retryable
	}
	return ce.Code == "unavailable" || ce.Code == "deadline_exceeded"
}
