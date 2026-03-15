package sse

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

// Consumer reads from Redis Streams and broadcasts events via the Broker.
type Consumer struct {
	rdb          *redis.Client
	group        string
	consumerName string
	broker       *Broker
}

func NewConsumer(rdb *redis.Client, broker *Broker) *Consumer {
	hostname, _ := os.Hostname()
	return &Consumer{
		rdb:          rdb,
		group:        "gateway-sse",
		consumerName: fmt.Sprintf("gateway-%s-%d", hostname, os.Getpid()),
		broker:       broker,
	}
}

// Run starts the consumer loop. It blocks until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context) error {
	streams := []string{"finding-events", "notification-events"}
	slog.Info("sse consumer starting",
		"group", c.group,
		"consumer", c.consumerName,
		"streams", streams,
	)

	c.recoverPending(ctx, streams)

	xreadArgs := make([]string, 0, len(streams)*2)
	for _, s := range streams {
		xreadArgs = append(xreadArgs, s)
	}
	for range streams {
		xreadArgs = append(xreadArgs, ">")
	}

	for {
		select {
		case <-ctx.Done():
			slog.Info("sse consumer stopping")
			return nil
		default:
		}

		results, err := c.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    c.group,
			Consumer: c.consumerName,
			Streams:  xreadArgs,
			Count:    10,
			Block:    5 * time.Second,
		}).Result()

		if err != nil {
			if err == redis.Nil || ctx.Err() != nil {
				continue
			}
			slog.Error("XREADGROUP failed", "error", err)
			time.Sleep(1 * time.Second)
			continue
		}

		for _, stream := range results {
			for _, msg := range stream.Messages {
				event := c.toEvent(stream.Stream, msg)
				c.broker.Broadcast(event)

				if err := c.rdb.XAck(ctx, stream.Stream, c.group, msg.ID).Err(); err != nil {
					slog.Error("XACK failed", "stream", stream.Stream, "id", msg.ID, "error", err)
				}
			}
		}
	}
}

func (c *Consumer) toEvent(stream string, msg redis.XMessage) Event {
	eventType := "unknown"
	switch stream {
	case "finding-events":
		eventType = "finding_changed"
	case "notification-events":
		eventType = "notification_sent"
	}

	// Use the "payload" field if present, otherwise marshal all values
	data, ok := msg.Values["payload"].(string)
	if !ok {
		data = fmt.Sprintf(`{"stream":"%s","id":"%s"}`, stream, msg.ID)
	}

	projectID := extractProjectID(data)

	return Event{
		ID:        msg.ID,
		Type:      eventType,
		ProjectID: projectID,
		Data:      data,
	}
}

func extractProjectID(data string) string {
	var payload struct {
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal([]byte(data), &payload); err != nil {
		return ""
	}
	return payload.ProjectID
}

func (c *Consumer) recoverPending(ctx context.Context, streams []string) {
	for _, stream := range streams {
		claimed, _, err := c.rdb.XAutoClaim(ctx, &redis.XAutoClaimArgs{
			Stream:   stream,
			Group:    c.group,
			Consumer: c.consumerName,
			MinIdle:  60 * time.Second,
			Start:    "0-0",
			Count:    100,
		}).Result()

		if err != nil {
			slog.Warn("XAUTOCLAIM failed", "stream", stream, "error", err)
			continue
		}

		for _, msg := range claimed {
			event := c.toEvent(stream, msg)
			c.broker.Broadcast(event)
			c.rdb.XAck(ctx, stream, c.group, msg.ID)
		}

		if len(claimed) > 0 {
			slog.Info("recovered pending messages", "stream", stream, "count", len(claimed))
		}
	}
}
