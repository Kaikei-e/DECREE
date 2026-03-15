package config

import (
	"testing"
)

func TestLoad_RequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	_, err := Load()
	if err == nil {
		t.Fatal("expected error when DATABASE_URL is empty")
	}
}

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://localhost/test")
	t.Setenv("REDIS_URL", "")
	t.Setenv("PORT", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.RedisURL != "redis://127.0.0.1:6379" {
		t.Errorf("RedisURL = %q, want default", cfg.RedisURL)
	}
	if cfg.Port != ":8400" {
		t.Errorf("Port = %q, want :8400", cfg.Port)
	}
}

func TestLoad_CustomValues(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgresql://db:5432/decree")
	t.Setenv("REDIS_URL", "redis://redis:6379")
	t.Setenv("PORT", ":9000")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.DatabaseURL != "postgresql://db:5432/decree" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if cfg.RedisURL != "redis://redis:6379" {
		t.Errorf("RedisURL = %q", cfg.RedisURL)
	}
	if cfg.Port != ":9000" {
		t.Errorf("Port = %q", cfg.Port)
	}
}
