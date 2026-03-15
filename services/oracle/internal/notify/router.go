package notify

import (
	"context"
	"log/slog"
	"time"

	"decree/services/oracle/internal/db"
	"decree/services/oracle/internal/diff"
)

// ChannelConfig pairs a channel with its severity threshold.
type ChannelConfig struct {
	Channel   Channel
	Threshold string // "critical", "high", "medium", "low"
}

// Router dispatches diff events to notification channels with filtering and dedup.
type Router struct {
	db       *db.DB
	channels []ChannelConfig
}

// NewRouter creates a notification router.
func NewRouter(database *db.DB, channels []ChannelConfig) *Router {
	return &Router{
		db:       database,
		channels: channels,
	}
}

// Notify sends notifications for diff events to all configured channels.
func (r *Router) Notify(ctx context.Context, events []diff.DiffEvent) {
	for _, evt := range events {
		msg := toMessage(evt)

		for _, cc := range r.channels {
			// Severity filter
			if diff.SeverityOrder(evt.Severity) < diff.SeverityOrder(cc.Threshold) {
				continue
			}

			// Dedup check
			dedupKey := DedupKey(evt.TargetID, evt.AdvisoryID, string(evt.Kind))
			if r.db != nil {
				dup, err := r.db.CheckDedup(ctx, dedupKey, cc.Channel.Name())
				if err != nil {
					slog.Error("dedup check failed", "error", err)
				} else if dup {
					slog.Debug("notification deduplicated",
						"channel", cc.Channel.Name(),
						"advisory", evt.AdvisoryID)
					continue
				}
			}

			// Send with retry
			err := r.sendWithRetry(ctx, cc.Channel, msg)

			// Log delivery
			if r.db != nil {
				status := "delivered"
				if err != nil {
					status = "failed"
				}
				logErr := r.db.InsertDeliveryLog(ctx, db.DeliveryRecord{
					TargetID:   evt.TargetID,
					AdvisoryID: evt.AdvisoryID,
					DiffKind:   string(evt.Kind),
					Channel:    cc.Channel.Name(),
					Status:     status,
					Attempts:   1,
					DedupKey:   dedupKey,
				})
				if logErr != nil {
					slog.Error("delivery log insert failed", "error", logErr)
				}
			}

			if err != nil {
				slog.Error("notification send failed",
					"channel", cc.Channel.Name(),
					"advisory", evt.AdvisoryID,
					"error", err)
			} else {
				slog.Info("notification sent",
					"channel", cc.Channel.Name(),
					"advisory", evt.AdvisoryID,
					"kind", evt.Kind)
			}
		}
	}
}

func (r *Router) sendWithRetry(ctx context.Context, ch Channel, msg NotificationMessage) error {
	backoffs := []time.Duration{1 * time.Second, 5 * time.Second, 30 * time.Second}

	var lastErr error
	for attempt := range len(backoffs) + 1 {
		err := ch.Send(ctx, msg)
		if err == nil {
			return nil
		}
		lastErr = err

		if attempt < len(backoffs) {
			slog.Warn("notification send failed, retrying",
				"channel", ch.Name(), "attempt", attempt+1, "error", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoffs[attempt]):
			}
		}
	}
	return lastErr
}

func toMessage(evt diff.DiffEvent) NotificationMessage {
	return NotificationMessage{
		TargetName:     evt.TargetName,
		AdvisoryID:     evt.AdvisoryID,
		PackageName:    evt.PackageName,
		PackageVersion: evt.PackageVersion,
		Ecosystem:      evt.Ecosystem,
		DiffKind:       string(evt.Kind),
		Severity:       evt.Severity,
		DecreeScore:    evt.DecreeScore,
		PrevScore:      evt.PrevScore,
		EPSSScore:      evt.EPSSScore,
		HasExploit:     evt.HasExploit,
		FixVersions:    evt.FixVersions,
	}
}
