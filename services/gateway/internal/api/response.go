package api

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/google/uuid"
)

type PagedResponse[T any] struct {
	Data       []T     `json:"data"`
	NextCursor *string `json:"next_cursor,omitempty"`
	HasMore    bool    `json:"has_more"`
}

type ErrorBody struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("json encode failed", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorBody{
		Error: ErrorDetail{Code: code, Message: message},
	})
}

// parseUUID parses a UUID string and returns an AppError on failure.
func parseUUID(s string) (uuid.UUID, error) {
	id, err := uuid.Parse(s)
	if err != nil {
		return uuid.Nil, ErrBadRequest("invalid_id", "invalid UUID: "+s)
	}
	return id, nil
}

func parseLimit(r *http.Request, defaultLimit, maxLimit int) int {
	s := r.URL.Query().Get("limit")
	if s == "" {
		return defaultLimit
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return defaultLimit
	}
	if n > maxLimit {
		return maxLimit
	}
	return n
}

// Finding cursor: "score|instance_id" base64-encoded
func encodeFindingCursor(score float32, id uuid.UUID) string {
	raw := fmt.Sprintf("%v|%s", score, id.String())
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func parseFindingCursor(s string) (*db.FindingCursor, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor encoding")
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor format")
	}
	score, err := strconv.ParseFloat(parts[0], 32)
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor score")
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor id")
	}
	return &db.FindingCursor{Score: float32(score), InstanceID: id}, nil
}

// Timeline cursor: "occurred_at|id" base64-encoded
func encodeTimelineCursor(t time.Time, id uuid.UUID) string {
	raw := fmt.Sprintf("%s|%s", t.Format(time.RFC3339Nano), id.String())
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func parseTimelineCursor(s string) (*db.TimelineCursor, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor encoding")
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor time")
	}
	id, err := uuid.Parse(parts[1])
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor id")
	}
	return &db.TimelineCursor{OccurredAt: t, ID: id}, nil
}
