package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type projectsHandler struct {
	store db.Store
}

func (h *projectsHandler) list(w http.ResponseWriter, r *http.Request) {
	projects, err := h.store.ListProjects(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "failed to list projects")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": projects})
}
