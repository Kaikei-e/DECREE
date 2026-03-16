package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type topRisksHandler struct {
	store db.Store
}

func (h *topRisksHandler) list(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	limit := parseLimit(r, 10, 50)

	risks, err := h.store.ListTopRisks(r.Context(), projectID, limit)
	if err != nil {
		return ErrInternal("failed to list top risks", err)
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": risks})
	return nil
}
