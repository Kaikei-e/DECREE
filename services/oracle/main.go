package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"decree/services/oracle/internal/config"
	"decree/services/oracle/internal/db"
	"decree/services/oracle/internal/diff"
	"decree/services/oracle/internal/health"
	"decree/services/oracle/internal/notify"
	"decree/services/oracle/internal/scanner"
	"decree/services/oracle/internal/scheduler"
	"decree/services/oracle/internal/stream"
)

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

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// DB pool
	database, err := db.Connect(ctx, cfg.DB.URL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer database.Close()

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

	var wg sync.WaitGroup

	// Start health server
	wg.Add(1)
	go func() {
		defer wg.Done()
		slog.Info("decree-oracle starting", "addr", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			cancel()
		}
	}()

	// Start scheduler
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := sched.Run(ctx); err != nil {
			slog.Error("scheduler failed", "error", err)
		}
	}()

	// Start stream consumer
	if cfg.Diff.Enabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := consumer.Run(ctx, []string{"scan-events"}); err != nil {
				slog.Error("stream consumer failed", "error", err)
			}
		}()
	}

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	slog.Info("shutting down", "signal", sig.String())

	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("http shutdown error", "error", err)
	}

	wg.Wait()
	slog.Info("decree-oracle stopped")
}
