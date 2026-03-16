package api

import (
	"net/http"
	"time"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/google/uuid"
)

type timelineHandler struct {
	store db.Store
}

func (h *timelineHandler) list(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	q := r.URL.Query()
	params := db.TimelineParams{
		ProjectID: projectID,
		Limit:     parseLimit(r, 100, 500),
	}

	if v := q.Get("target_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			return ErrBadRequest("invalid_id", "invalid target_id")
		}
		params.TargetID = &id
	}
	if v := q.Get("event_type"); v != "" {
		params.EventType = &v
	}
	if v := q.Get("from"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return ErrBadRequest("invalid_param", "invalid from datetime")
		}
		params.From = &t
	}
	if v := q.Get("to"); v != "" {
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return ErrBadRequest("invalid_param", "invalid to datetime")
		}
		params.To = &t
	}

	cursor, err := parseTimelineCursor(q.Get("cursor"))
	if err != nil {
		return err
	}
	params.Cursor = cursor

	events, hasMore, err := h.store.ListTimeline(r.Context(), params)
	if err != nil {
		return ErrInternal("failed to list timeline", err)
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
	return nil
}
