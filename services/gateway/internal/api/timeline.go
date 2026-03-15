package api

import (
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type timelineHandler struct {
	store db.Store
}

func (h *timelineHandler) list(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}

	q := r.URL.Query()
	params := db.TimelineParams{
		ProjectID: projectID,
		Limit:     parseLimit(r, 100, 500),
	}

	if v := q.Get("target_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_id", "invalid target_id")
			return
		}
		params.TargetID = &id
	}
	if v := q.Get("event_type"); v != "" {
		params.EventType = &v
	}
	if v := q.Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_param", "invalid from datetime")
			return
		}
		params.From = &t
	}
	if v := q.Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_param", "invalid to datetime")
			return
		}
		params.To = &t
	}

	cursor, err := parseTimelineCursor(q.Get("cursor"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_cursor", err.Error())
		return
	}
	params.Cursor = cursor

	events, hasMore, err := h.store.ListTimeline(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "failed to list timeline")
		return
	}

	resp := PagedResponse[db.TimelineEvent]{
		Data:    events,
		HasMore: hasMore,
	}
	if hasMore && len(events) > 0 {
		last := events[len(events)-1]
		c := encodeTimelineCursor(last.OccurredAt, last.ID)
		resp.NextCursor = &c
	}

	writeJSON(w, http.StatusOK, resp)
}
