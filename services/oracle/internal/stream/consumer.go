package stream

import (
	"context"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"

	"decree/services/oracle/internal/identity"
)

// ConsumerOption configures the Consumer.
type ConsumerOption func(*Consumer)

// WithConsumerLogger sets a custom logger for the Consumer.
func WithConsumerLogger(l *slog.Logger) ConsumerOption {
	return func(c *Consumer) { c.log = l }
}

// Consumer reads from Redis Streams using XREADGROUP.
type Consumer struct {
	rdb          *redis.Client
	group        string
	consumerName string
	handler      Handler
	log          *slog.Logger
}

// Handler processes a stream message.
type Handler interface {
	Handle(ctx context.Context, stream string, msg redis.XMessage) error
}

// NewConsumer creates a stream consumer.
func NewConsumer(rdb *redis.Client, handler Handler, opts ...ConsumerOption) *Consumer {
	c := &Consumer{
		rdb:          rdb,
		group:        "oracle-diff",
		consumerName: identity.OracleConsumerID(),
		handler:      handler,
		log:          slog.Default(),
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

// Run starts the consumer loop. It blocks until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context, streams []string) error {
	c.log.InfoContext(ctx, "stream consumer starting",
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
			c.log.InfoContext(ctx, "stream consumer stopping")
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
			c.log.ErrorContext(ctx, "XREADGROUP failed", "error", err)
			time.Sleep(1 * time.Second)
			continue
		}

		for _, stream := range results {
			for _, msg := range stream.Messages {
				if err := c.handler.Handle(ctx, stream.Stream, msg); err != nil {
					c.log.ErrorContext(ctx, "message handling failed",
						"stream", stream.Stream,
						"id", msg.ID,
						"error", err)
					// Don't ACK — will be redelivered
					continue
				}

				if err := c.rdb.XAck(ctx, stream.Stream, c.group, msg.ID).Err(); err != nil {
					c.log.ErrorContext(ctx, "XACK failed", "stream", stream.Stream, "id", msg.ID, "error", err)
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
			c.log.WarnContext(ctx, "XAUTOCLAIM failed", "stream", stream, "error", err)
			continue
		}

		for _, msg := range claimed {
			if err := c.handler.Handle(ctx, stream, msg); err != nil {
				c.log.ErrorContext(ctx, "pending message handling failed",
					"stream", stream, "id", msg.ID, "error", err)
				continue
			}
			c.rdb.XAck(ctx, stream, c.group, msg.ID)
		}

		if len(claimed) > 0 {
			c.log.InfoContext(ctx, "recovered pending messages", "stream", stream, "count", len(claimed))
		}
	}
}
