package config

import (
	"fmt"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Project  ProjectConfig     `yaml:"project"`
	Targets  TargetsConfig     `yaml:"targets"`
	Scan     ScanConfig        `yaml:"scan"`
	Diff     DiffConfig        `yaml:"diff"`
	Notify   NotifyConfig      `yaml:"notify"`
	DB       DBConfig          `yaml:"-"`
	RedisURL string            `yaml:"-"`
	Scanner  ScannerConnConfig `yaml:"-"`
}

type ProjectConfig struct {
	Name string `yaml:"name"`
}

type TargetsConfig struct {
	Repositories []RepositoryTarget `yaml:"repositories"`
	Containers   []ContainerTarget  `yaml:"containers"`
}

type RepositoryTarget struct {
	Name   string `yaml:"name"`
	URL    string `yaml:"url"`
	Branch string `yaml:"branch"`
}

type ContainerTarget struct {
	Name  string `yaml:"name"`
	Image string `yaml:"image"`
}

type ScanConfig struct {
	Interval             Duration                   `yaml:"interval"`
	InitialScan          bool                       `yaml:"initial_scan"`
	VulnerabilityRefresh VulnerabilityRefreshConfig `yaml:"vulnerability_refresh"`
}

type VulnerabilityRefreshConfig struct {
	EPSS Duration `yaml:"epss"`
	OSV  Duration `yaml:"osv"`
	NVD  Duration `yaml:"nvd"`
}

type DiffConfig struct {
	Enabled bool     `yaml:"enabled"`
	Track   []string `yaml:"track"`
}

type NotifyConfig struct {
	Slack   *SlackConfig   `yaml:"slack,omitempty"`
	Discord *DiscordConfig `yaml:"discord,omitempty"`
	Webhook *WebhookConfig `yaml:"webhook,omitempty"`
}

type SlackConfig struct {
	WebhookURL         string `yaml:"webhook_url"`
	SeverityThreshold  string `yaml:"severity_threshold"`
	IncludeDecreeScore bool   `yaml:"include_decree_score"`
}

type DiscordConfig struct {
	WebhookURL        string `yaml:"webhook_url"`
	SeverityThreshold string `yaml:"severity_threshold"`
}

type WebhookConfig struct {
	URL     string            `yaml:"url"`
	Method  string            `yaml:"method"`
	Headers map[string]string `yaml:"headers"`
}

type DBConfig struct {
	URL string
}

type ScannerConnConfig struct {
	BaseURL string
}

// Duration wraps time.Duration for YAML unmarshaling.
type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalYAML(value *yaml.Node) error {
	var s string
	if err := value.Decode(&s); err != nil {
		return err
	}
	dur, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", s, err)
	}
	d.Duration = dur
	return nil
}

func (d Duration) MarshalYAML() (any, error) {
	return d.Duration.String(), nil
}

// Load reads decree.yaml from path, expands env vars, and populates non-YAML config from env/secrets.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	expanded := expandEnvVars(string(data))

	var cfg Config
	if err := yaml.Unmarshal([]byte(expanded), &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}

	cfg.DB.URL = getEnvOrSecret("DATABASE_URL", "")
	cfg.RedisURL = getEnvOrSecret("REDIS_URL", "redis://127.0.0.1:6379")
	cfg.Scanner.BaseURL = getEnvOrSecret("SCANNER_URL", "http://decree-scanner:9000")

	if cfg.Notify.Slack != nil {
		cfg.Notify.Slack.WebhookURL = resolveValue(cfg.Notify.Slack.WebhookURL)
	}
	if cfg.Notify.Discord != nil {
		cfg.Notify.Discord.WebhookURL = resolveValue(cfg.Notify.Discord.WebhookURL)
	}
	if cfg.Notify.Webhook != nil {
		cfg.Notify.Webhook.URL = resolveValue(cfg.Notify.Webhook.URL)
		for k, v := range cfg.Notify.Webhook.Headers {
			cfg.Notify.Webhook.Headers[k] = resolveValue(v)
		}
	}

	return &cfg, nil
}

// expandEnvVars replaces ${VAR_NAME} patterns with environment variable values.
func expandEnvVars(s string) string {
	return os.Expand(s, func(key string) string {
		return getEnvOrSecret(key, "")
	})
}

// resolveValue expands ${VAR} patterns in a single value.
func resolveValue(s string) string {
	if strings.HasPrefix(s, "${") && strings.HasSuffix(s, "}") {
		key := s[2 : len(s)-1]
		return getEnvOrSecret(key, "")
	}
	return expandEnvVars(s)
}

// getEnvOrSecret reads from env, then falls back to Docker secret file.
func getEnvOrSecret(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	secretPath := "/run/secrets/" + strings.ToLower(key)
	if data, err := os.ReadFile(secretPath); err == nil {
		return strings.TrimSpace(string(data))
	}
	return fallback
}
