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

// Finding cursor: "v1|<sort key>|<direction>|<instance id>|<sort value>",
// base64url-encoded. The sort value comes last so text values may contain "|".
// Sort key and direction are embedded so a cursor minted under a different sort
// is rejected instead of silently paging through the wrong key space.
const cursorVersion = "v1"

func encodeFindingCursor(key db.SortKey, desc bool, f db.Finding) string {
	raw := strings.Join([]string{
		cursorVersion,
		string(key),
		sortDirection(desc),
		f.InstanceID.String(),
		db.FormatSortValue(key, f),
	}, "|")
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func sortDirection(desc bool) string {
	if desc {
		return "desc"
	}
	return "asc"
}

func parseFindingCursor(s string, key db.SortKey, desc bool) (*db.FindingCursor, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor encoding")
	}
	parts := strings.SplitN(string(raw), "|", 5)
	if len(parts) != 5 || parts[0] != cursorVersion {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor format")
	}
	if parts[1] != string(key) || parts[2] != sortDirection(desc) {
		return nil, ErrBadRequest("cursor_sort_mismatch",
			"cursor was issued for a different sort order; restart pagination without a cursor")
	}
	id, err := uuid.Parse(parts[3])
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor id")
	}
	value, err := db.ParseSortValue(key, parts[4])
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor value")
	}
	return &db.FindingCursor{Sort: key, Desc: desc, Value: value, InstanceID: id}, nil
}

// Advisory cursor: "v1|<sort key>|<direction>|<sort value>|<advisory id>",
// base64url-encoded. The advisory id is last because it is free-form text; for
// sort=advisory it is also the sort value, so the value segment stays empty.
func encodeAdvisoryCursor(key db.SortKey, desc bool, g db.AdvisoryGroup) string {
	value := db.FormatAdvisorySortValue(key, g)
	if key == db.SortAdvisory {
		value = ""
	}
	raw := strings.Join([]string{
		cursorVersion,
		string(key),
		sortDirection(desc),
		value,
		g.AdvisoryID,
	}, "|")
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func parseAdvisoryCursor(s string, key db.SortKey, desc bool) (*db.AdvisoryCursor, error) {
	if s == "" {
		return nil, nil
	}
	raw, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor encoding")
	}
	parts := strings.SplitN(string(raw), "|", 5)
	if len(parts) != 5 || parts[0] != cursorVersion {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor format")
	}
	if parts[1] != string(key) || parts[2] != sortDirection(desc) {
		return nil, ErrBadRequest("cursor_sort_mismatch",
			"cursor was issued for a different sort order; restart pagination without a cursor")
	}
	advisoryID := parts[4]
	if advisoryID == "" {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor id")
	}
	rawValue := parts[3]
	if key == db.SortAdvisory {
		rawValue = advisoryID
	}
	value, err := db.ParseAdvisorySortValue(key, rawValue)
	if err != nil {
		return nil, ErrBadRequest("invalid_cursor", "invalid cursor value")
	}
	return &db.AdvisoryCursor{Sort: key, Desc: desc, Value: value, AdvisoryID: advisoryID}, nil
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
