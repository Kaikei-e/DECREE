package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type topRisksHandler struct {
	store db.Store
}

func (h *topRisksHandler) list(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}

	limit := parseLimit(r, 10, 50)

	risks, err := h.store.ListTopRisks(r.Context(), projectID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "failed to list top risks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": risks})
}
