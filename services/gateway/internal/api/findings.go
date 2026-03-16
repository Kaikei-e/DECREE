package api

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type findingsHandler struct {
	store db.Store
}

func (h *findingsHandler) list(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	q := r.URL.Query()
	params := db.FindingParams{
		ProjectID:  projectID,
		ActiveOnly: q.Get("active_only") == "true",
		Limit:      parseLimit(r, 50, 200),
	}

	if v := q.Get("severity"); v != "" {
		lower := strings.ToLower(v)
		params.Severity = &lower
	}
	if v := q.Get("ecosystem"); v != "" {
		params.Ecosystem = &v
	}
	if v := q.Get("min_epss"); v != "" {
		f, err := strconv.ParseFloat(v, 32)
		if err == nil {
			f32 := float32(f)
			params.MinEPSS = &f32
		}
	}

	cursor, err := parseFindingCursor(q.Get("cursor"))
	if err != nil {
		return err
	}
	params.Cursor = cursor

	findings, hasMore, err := h.store.ListFindings(r.Context(), params)
	if err != nil {
		return ErrInternal("failed to list findings", err)
	}

	resp := PagedResponse[db.Finding]{
		Data:    findings,
		HasMore: hasMore,
	}
	if hasMore && len(findings) > 0 {
		last := findings[len(findings)-1]
		score := float32(0)
		if last.DecreeScore != nil {
			score = *last.DecreeScore
		}
		c := encodeFindingCursor(score, last.InstanceID)
		resp.NextCursor = &c
	}

	writeJSON(w, http.StatusOK, resp)
	return nil
}
