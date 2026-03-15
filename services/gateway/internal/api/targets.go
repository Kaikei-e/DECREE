package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type targetsHandler struct {
	store db.Store
}

func (h *targetsHandler) list(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseUUID(w, r.PathValue("id"))
	if !ok {
		return
	}

	targets, err := h.store.ListTargets(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "failed to list targets")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": targets})
}
