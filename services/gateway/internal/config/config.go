package config

import (
	"fmt"
	"net/url"
	"os"
)

type Config struct {
	DatabaseURL string
	RedisURL    string
	Port        string
}

func Load() (*Config, error) {
	cfg := &Config{
		RedisURL: envOr("REDIS_URL", "redis://127.0.0.1:6379"),
		Port:     envOr("PORT", ":8400"),
	}

	var err error
	cfg.DatabaseURL, err = envRequired("DATABASE_URL")
	if err != nil {
		return nil, err
	}

	if _, err := url.Parse(cfg.DatabaseURL); err != nil {
		return nil, fmt.Errorf("invalid DATABASE_URL: %w", err)
	}

	return cfg, nil
}

func envRequired(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("required environment variable %s is not set", key)
	}
	return v, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
