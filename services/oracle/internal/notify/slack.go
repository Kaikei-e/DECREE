package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

// SlackChannel sends notifications via Slack webhook using Block Kit.
type SlackChannel struct {
	webhookURL string
	httpClient *http.Client
}

// NewSlackChannel creates a Slack notification channel.
func NewSlackChannel(webhookURL string) *SlackChannel {
	return &SlackChannel{
		webhookURL: webhookURL,
		httpClient: &http.Client{},
	}
}

func (s *SlackChannel) Name() string { return "slack" }

func (s *SlackChannel) Send(ctx context.Context, msg NotificationMessage) error {
	payload := s.buildPayload(msg)

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal slack payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create slack request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("slack webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slack returned %d", resp.StatusCode)
	}

	return nil
}

func (s *SlackChannel) buildPayload(msg NotificationMessage) map[string]any {
	color := severityColor(msg.Severity)
	title := diffKindTitle(msg.DiffKind)

	var fields []map[string]any

	fields = append(fields, slackField("Target", msg.TargetName, true))
	fields = append(fields, slackField("Advisory", msg.AdvisoryID, true))
	fields = append(fields, slackField("Package", fmt.Sprintf("%s@%s", msg.PackageName, msg.PackageVersion), true))
	fields = append(fields, slackField("Severity", strings.ToUpper(msg.Severity), true))

	if msg.DecreeScore != nil {
		fields = append(fields, slackField("DECREE Score", fmt.Sprintf("%.1f", *msg.DecreeScore), true))
	}
	if msg.PrevScore != nil {
		fields = append(fields, slackField("Previous Score", fmt.Sprintf("%.1f", *msg.PrevScore), true))
	}
	if msg.EPSSScore != nil {
		fields = append(fields, slackField("EPSS", fmt.Sprintf("%.4f", *msg.EPSSScore), true))
	}

	exploitText := "No"
	if msg.HasExploit {
		exploitText = "Yes"
	}
	fields = append(fields, slackField("Exploit Available", exploitText, true))

	if len(msg.FixVersions) > 0 {
		fields = append(fields, slackField("Fix Versions", strings.Join(msg.FixVersions, ", "), false))
	}

	return map[string]any{
		"attachments": []map[string]any{
			{
				"color":  color,
				"blocks": []map[string]any{
					{
						"type": "header",
						"text": map[string]any{
							"type": "plain_text",
							"text": title,
						},
					},
					{
						"type":   "section",
						"fields": fields,
					},
				},
			},
		},
	}
}

func slackField(title, value string, short bool) map[string]any {
	_ = short // Slack Block Kit uses mrkdwn fields in section
	return map[string]any{
		"type": "mrkdwn",
		"text": fmt.Sprintf("*%s*\n%s", title, value),
	}
}

func severityColor(severity string) string {
	switch severity {
	case "critical":
		return "#e01e5a" // red
	case "high":
		return "#ff9900" // orange
	case "medium":
		return "#f2c744" // yellow
	default:
		return "#cccccc" // gray
	}
}

func diffKindTitle(kind string) string {
	switch kind {
	case "new_cve":
		return "New Vulnerability Detected"
	case "resolved_cve":
		return "Vulnerability Resolved"
	case "score_change":
		return "DECREE Score Changed"
	case "new_exploit":
		return "New Exploit Available"
	default:
		return "Vulnerability Update"
	}
}
