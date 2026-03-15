package notify

import (
	"crypto/sha256"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// DedupKey generates a dedup key for a notification.
// Format: sha256(targetID + advisoryID + diffKind + YYYY-MM-DD)
func DedupKey(targetID uuid.UUID, advisoryID string, diffKind string) string {
	date := time.Now().UTC().Format("2006-01-02")
	raw := fmt.Sprintf("%s:%s:%s:%s", targetID.String(), advisoryID, diffKind, date)
	hash := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("%x", hash)
}
