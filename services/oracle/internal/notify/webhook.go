package notify

import (
	"context"
	"net/http"
	"time"
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
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (w *WebhookChannel) Name() string { return "webhook" }

func (w *WebhookChannel) Send(ctx context.Context, msg NotificationMessage) error {
	return sendJSON(ctx, w.httpClient, w.method, w.url, w.headers, msg)
}
