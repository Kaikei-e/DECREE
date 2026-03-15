package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// WebhookChannel sends notifications to a generic webhook endpoint.
type WebhookChannel struct {
	url        string
	method     string
	headers    map[string]string
	httpClient *http.Client
}

// NewWebhookChannel creates a generic webhook notification channel.
func NewWebhookChannel(url, method string, headers map[string]string) *WebhookChannel {
	if method == "" {
		method = http.MethodPost
	}
	return &WebhookChannel{
		url:        url,
		method:     method,
		headers:    headers,
		httpClient: &http.Client{},
	}
}

func (w *WebhookChannel) Name() string { return "webhook" }

func (w *WebhookChannel) Send(ctx context.Context, msg NotificationMessage) error {
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal webhook payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, w.method, w.url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create webhook request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	for k, v := range w.headers {
		req.Header.Set(k, v)
	}

	resp, err := w.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}

	return nil
}
