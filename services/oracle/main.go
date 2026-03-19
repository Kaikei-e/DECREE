package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	"decree/services/oracle/internal/config"
	"decree/services/oracle/internal/db"
	"decree/services/oracle/internal/diff"
	"decree/services/oracle/internal/health"
	"decree/services/oracle/internal/notify"
	"decree/services/oracle/internal/scanner"
	"decree/services/oracle/internal/scheduler"
	"decree/services/oracle/internal/stream"
)

type resolvedFindingBackfiller interface {
	BackfillResolvedFindings(ctx context.Context) (int64, error)
}

func runStartupBackfill(ctx context.Context, database resolvedFindingBackfiller) {
	if count, err := database.BackfillResolvedFindings(ctx); err != nil {
		slog.Warn("backfill resolved findings failed", "error", err)
	} else if count > 0 {
		slog.Info("backfilled resolved findings", "count", count)
	}
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// Load config
	cfgPath := os.Getenv("DECREE_CONFIG")
	if cfgPath == "" {
		cfgPath = "decree.yaml"
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		slog.Error("failed to load config", "path", cfgPath, "error", err)
		os.Exit(1)
	}

	slog.Info("config loaded", "project", cfg.Project.Name)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// DB pool
	database, err := db.Connect(ctx, cfg.DB.URL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	// Backfill stale resolved findings from before the ResolveFinding fix.
	runStartupBackfill(ctx, database)

	// Redis client
	redisOpt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("invalid redis url", "error", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(redisOpt)
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("redis ping failed", "error", err)
		os.Exit(1)
	}

	// Scanner client
	scannerClient := scanner.NewClient(cfg.Scanner.BaseURL)

	// Diff engine
	diffEngine := diff.NewEngine(database)

	// Notification channels
	var channels []notify.ChannelConfig
	if cfg.Notify.Slack != nil && cfg.Notify.Slack.WebhookURL != "" {
		channels = append(channels, notify.ChannelConfig{
			Channel:   notify.NewSlackChannel(cfg.Notify.Slack.WebhookURL),
			Threshold: cfg.Notify.Slack.SeverityThreshold,
		})
		slog.Info("slack notifications enabled", "threshold", cfg.Notify.Slack.SeverityThreshold)
	}
	if cfg.Notify.Discord != nil && cfg.Notify.Discord.WebhookURL != "" {
		channels = append(channels, notify.ChannelConfig{
			Channel:   notify.NewDiscordChannel(cfg.Notify.Discord.WebhookURL),
			Threshold: cfg.Notify.Discord.SeverityThreshold,
		})
		slog.Info("discord notifications enabled", "threshold", cfg.Notify.Discord.SeverityThreshold)
	}
	if cfg.Notify.Webhook != nil && cfg.Notify.Webhook.URL != "" {
		channels = append(channels, notify.ChannelConfig{
			Channel:   notify.NewWebhookChannel(cfg.Notify.Webhook.URL, cfg.Notify.Webhook.Method, cfg.Notify.Webhook.Headers),
			Threshold: "low", // generic webhook receives everything
		})
		slog.Info("generic webhook notifications enabled")
	}

	notifier := notify.NewRouter(database, channels)

	// Scheduler
	leaseMgr := scheduler.NewLeaseManager(database)
	sched := scheduler.New(cfg, database, scannerClient, leaseMgr)

	// Stream consumer
	eventRouter := stream.NewEventRouter(diffEngine, notifier)
	consumer := stream.NewConsumer(rdb, eventRouter)

	// Health server
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", health.Handler)

	srv := &http.Server{
		Addr:         ":9100",
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	g, gCtx := errgroup.WithContext(ctx)

	// Health server
	g.Go(func() error {
		slog.Info("decree-oracle starting", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	})

	// Scheduler
	g.Go(func() error {
		return sched.Run(gCtx)
	})

	// Stream consumer
	if cfg.Diff.Enabled {
		g.Go(func() error {
			return consumer.Run(gCtx, []string{"scan-events"})
		})
	}

	// Graceful shutdown: wait for context cancellation, then shut down HTTP server
	g.Go(func() error {
		<-gCtx.Done()
		slog.Info("shutting down")

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		return srv.Shutdown(shutdownCtx)
	})

	if err := g.Wait(); err != nil {
		slog.Error("oracle exited with error", "error", err)
	}
	slog.Info("decree-oracle stopped")
}
