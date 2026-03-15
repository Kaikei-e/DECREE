package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL string
	RedisURL    string
	Port        string
}

func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://127.0.0.1:6379"
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = ":8400"
	}

	return &Config{
		DatabaseURL: dbURL,
		RedisURL:    redisURL,
		Port:        port,
	}, nil
}
