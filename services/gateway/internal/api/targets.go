package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type targetsHandler struct {
	store db.Store
}

func (h *targetsHandler) list(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	targets, err := h.store.ListTargets(r.Context(), projectID)
	if err != nil {
		return ErrInternal("failed to list targets", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": targets})
	return nil
}
