package notify

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// DiscordChannel sends notifications via Discord webhook using embeds.
type DiscordChannel struct {
	webhookURL string
	httpClient *http.Client
}

// NewDiscordChannel creates a Discord notification channel.
func NewDiscordChannel(webhookURL string) *DiscordChannel {
	return &DiscordChannel{
		webhookURL: webhookURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (d *DiscordChannel) Name() string { return "discord" }

func (d *DiscordChannel) Send(ctx context.Context, msg NotificationMessage) error {
	payload := d.buildPayload(msg)
	return sendJSON(ctx, d.httpClient, http.MethodPost, d.webhookURL, nil, payload, http.StatusOK, http.StatusNoContent)
}

func (d *DiscordChannel) buildPayload(msg NotificationMessage) map[string]any {
	color := discordColor(msg.Severity)
	title := diffKindTitle(msg.DiffKind)

	var fields []map[string]any
	fields = append(fields, discordField("Target", msg.TargetName, true))
	fields = append(fields, discordField("Advisory", msg.AdvisoryID, true))
	fields = append(fields, discordField("Package", fmt.Sprintf("%s@%s", msg.PackageName, msg.PackageVersion), true))
	fields = append(fields, discordField("Severity", strings.ToUpper(msg.Severity), true))

	if msg.DecreeScore != nil {
		fields = append(fields, discordField("DECREE Score", fmt.Sprintf("%.1f", *msg.DecreeScore), true))
	}
	if msg.EPSSScore != nil {
		fields = append(fields, discordField("EPSS", fmt.Sprintf("%.4f", *msg.EPSSScore), true))
	}

	exploitText := "No"
	if msg.HasExploit {
		exploitText = "Yes"
	}
	fields = append(fields, discordField("Exploit Available", exploitText, true))

	if len(msg.FixVersions) > 0 {
		fields = append(fields, discordField("Fix Versions", strings.Join(msg.FixVersions, ", "), false))
	}

	return map[string]any{
		"embeds": []map[string]any{
			{
				"title":  title,
				"color":  color,
				"fields": fields,
			},
		},
	}
}

func discordField(name, value string, inline bool) map[string]any {
	return map[string]any{
		"name":   name,
		"value":  value,
		"inline": inline,
	}
}

func discordColor(severity string) int {
	switch severity {
	case "critical":
		return 0xe01e5a // red
	case "high":
		return 0xff9900 // orange
	case "medium":
		return 0xf2c744 // yellow
	default:
		return 0xcccccc // gray
	}
}
