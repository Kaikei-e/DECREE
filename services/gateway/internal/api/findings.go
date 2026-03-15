package api

import (
	"net/http"
	"strconv"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type findingsHandler struct {
	store db.Store
}

func (h *findingsHandler) list(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}

	q := r.URL.Query()
	params := db.FindingParams{
		ProjectID:  projectID,
		ActiveOnly: q.Get("active_only") == "true",
		Limit:      parseLimit(r, 50, 200),
	}

	if v := q.Get("severity"); v != "" {
		params.Severity = &v
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
		writeError(w, http.StatusBadRequest, "invalid_cursor", err.Error())
		return
	}
	params.Cursor = cursor

	findings, hasMore, err := h.store.ListFindings(r.Context(), params)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "failed to list findings")
		return
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
}
