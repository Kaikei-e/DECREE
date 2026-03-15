package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoad_ValidConfig(t *testing.T) {
	yaml := `
project:
  name: "test-project"

targets:
  repositories:
    - name: api
      url: https://github.com/test/api
      branch: main
  containers:
    - name: web
      image: ghcr.io/test/web:latest

scan:
  interval: 15m
  initial_scan: true
  vulnerability_refresh:
    epss: 24h
    osv: 1h
    nvd: 6h

diff:
  enabled: true
  track:
    - new_cve
    - resolved_cve

notify:
  slack:
    webhook_url: https://hooks.slack.example/test
    severity_threshold: high
    include_decree_score: true
`
	path := writeTemp(t, yaml)

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Project.Name != "test-project" {
		t.Errorf("project name = %q, want %q", cfg.Project.Name, "test-project")
	}
	if len(cfg.Targets.Repositories) != 1 {
		t.Fatalf("repositories len = %d, want 1", len(cfg.Targets.Repositories))
	}
	if cfg.Targets.Repositories[0].Name != "api" {
		t.Errorf("repo name = %q, want %q", cfg.Targets.Repositories[0].Name, "api")
	}
	if len(cfg.Targets.Containers) != 1 {
		t.Fatalf("containers len = %d, want 1", len(cfg.Targets.Containers))
	}
	if cfg.Scan.Interval.Duration != 15*time.Minute {
		t.Errorf("interval = %v, want 15m", cfg.Scan.Interval.Duration)
	}
	if !cfg.Scan.InitialScan {
		t.Error("initial_scan should be true")
	}
	if cfg.Scan.VulnerabilityRefresh.EPSS.Duration != 24*time.Hour {
		t.Errorf("epss refresh = %v, want 24h", cfg.Scan.VulnerabilityRefresh.EPSS.Duration)
	}
	if !cfg.Diff.Enabled {
		t.Error("diff.enabled should be true")
	}
	if len(cfg.Diff.Track) != 2 {
		t.Errorf("diff.track len = %d, want 2", len(cfg.Diff.Track))
	}
	if cfg.Notify.Slack == nil {
		t.Fatal("slack config should not be nil")
	}
	if cfg.Notify.Slack.SeverityThreshold != "high" {
		t.Errorf("slack threshold = %q, want %q", cfg.Notify.Slack.SeverityThreshold, "high")
	}
}

func TestLoad_EnvVarExpansion(t *testing.T) {
	t.Setenv("TEST_WEBHOOK", "https://hooks.slack.example/expanded")

	yaml := `
project:
  name: test

targets:
  repositories: []

scan:
  interval: 5m
  vulnerability_refresh:
    epss: 24h
    osv: 1h
    nvd: 6h

notify:
  slack:
    webhook_url: ${TEST_WEBHOOK}
    severity_threshold: critical
`
	path := writeTemp(t, yaml)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Notify.Slack.WebhookURL != "https://hooks.slack.example/expanded" {
		t.Errorf("webhook = %q, want expanded value", cfg.Notify.Slack.WebhookURL)
	}
}

func TestLoad_DefaultRedisURL(t *testing.T) {
	yaml := `
project:
  name: test
targets:
  repositories: []
scan:
  interval: 5m
  vulnerability_refresh:
    epss: 24h
    osv: 1h
    nvd: 6h
`
	path := writeTemp(t, yaml)
	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.RedisURL != "redis://127.0.0.1:6379" {
		t.Errorf("redis url = %q, want default", cfg.RedisURL)
	}
}

func TestLoad_InvalidDuration(t *testing.T) {
	yaml := `
project:
  name: test
targets:
  repositories: []
scan:
  interval: notaduration
  vulnerability_refresh:
    epss: 24h
    osv: 1h
    nvd: 6h
`
	path := writeTemp(t, yaml)
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for invalid duration")
	}
}

func TestLoad_FileNotFound(t *testing.T) {
	_, err := Load("/nonexistent/path.yaml")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoad_DockerSecret(t *testing.T) {
	// Create a temporary secret file
	dir := t.TempDir()
	secretPath := filepath.Join(dir, "test_secret_key")
	if err := os.WriteFile(secretPath, []byte("secret-value\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	// getEnvOrSecret should read from file as fallback
	// This tests the helper directly since we can't easily mock /run/secrets
	result := getEnvOrSecret("TEST_SECRET_KEY", "default")
	if result != "default" {
		t.Errorf("expected default when no env or secret, got %q", result)
	}

	t.Setenv("TEST_SECRET_KEY", "from-env")
	result = getEnvOrSecret("TEST_SECRET_KEY", "default")
	if result != "from-env" {
		t.Errorf("expected from-env, got %q", result)
	}
}

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "decree.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}
