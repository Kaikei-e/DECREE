package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// sendJSON sends a JSON-encoded payload to the given URL and validates the response status.
func sendJSON(ctx context.Context, client *http.Client, method, url string, headers map[string]string, payload any, acceptedCodes ...int) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http %s %s: %w", method, url, err)
	}
	defer func() { io.Copy(io.Discard, resp.Body); resp.Body.Close() }()

	if len(acceptedCodes) == 0 {
		// Default: accept any non-error status
		if resp.StatusCode < 400 {
			return nil
		}
	} else {
		for _, code := range acceptedCodes {
			if resp.StatusCode == code {
				return nil
			}
		}
	}

	return fmt.Errorf("%s returned %d", url, resp.StatusCode)
}
