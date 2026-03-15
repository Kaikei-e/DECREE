package stream

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

// Consumer reads from Redis Streams using XREADGROUP.
type Consumer struct {
	rdb          *redis.Client
	group        string
	consumerName string
	handler      Handler
}

// Handler processes a stream message.
type Handler interface {
	Handle(ctx context.Context, stream string, msg redis.XMessage) error
}

// NewConsumer creates a stream consumer.
func NewConsumer(rdb *redis.Client, handler Handler) *Consumer {
	hostname, _ := os.Hostname()
	return &Consumer{
		rdb:          rdb,
		group:        "oracle-diff",
		consumerName: fmt.Sprintf("oracle-%s-%d", hostname, os.Getpid()),
		handler:      handler,
	}
}

// Run starts the consumer loop. It blocks until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context, streams []string) error {
	slog.Info("stream consumer starting",
		"group", c.group,
		"consumer", c.consumerName,
		"streams", streams)

	// Recover pending messages on startup
	c.recoverPending(ctx, streams)

	// Build XREADGROUP args: stream1 stream2 ... > >
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
			slog.Info("stream consumer stopping")
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
				if err := c.handler.Handle(ctx, stream.Stream, msg); err != nil {
					slog.Error("message handling failed",
						"stream", stream.Stream,
						"id", msg.ID,
						"error", err)
					// Don't ACK — will be redelivered
					continue
				}

				if err := c.rdb.XAck(ctx, stream.Stream, c.group, msg.ID).Err(); err != nil {
					slog.Error("XACK failed", "stream", stream.Stream, "id", msg.ID, "error", err)
				}
			}
		}
	}
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
			if err := c.handler.Handle(ctx, stream, msg); err != nil {
				slog.Error("pending message handling failed",
					"stream", stream, "id", msg.ID, "error", err)
				continue
			}
			c.rdb.XAck(ctx, stream, c.group, msg.ID)
		}

		if len(claimed) > 0 {
			slog.Info("recovered pending messages", "stream", stream, "count", len(claimed))
		}
	}
}
