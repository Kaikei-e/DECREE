package notify

import (
	"context"

	"decree/services/oracle/internal/domain"
)

// DeliveryStore provides access to notification delivery log operations.
type DeliveryStore interface {
	CheckDedup(ctx context.Context, dedupKey, channel string) (bool, error)
	InsertDeliveryLog(ctx context.Context, rec domain.DeliveryRecord) error
}
