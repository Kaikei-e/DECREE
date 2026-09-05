package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type projectsHandler struct {
	store db.Store
}

func (h *projectsHandler) list(w http.ResponseWriter, r *http.Request) error {
	projects, err := h.store.ListProjects(r.Context())
	if err != nil {
		return ErrInternal("failed to list projects", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": projects})
	return nil
}

func (h *projectsHandler) get(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	project, err := h.store.GetProject(r.Context(), projectID)
	if err != nil {
		return ErrInternal("failed to get project", err)
	}
	if project == nil {
		return ErrNotFound("not_found", "project not found")
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": project})
	return nil
}
