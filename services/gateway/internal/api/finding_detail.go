package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type findingDetailHandler struct {
	store db.Store
}

func (h *findingDetailHandler) get(w http.ResponseWriter, r *http.Request) error {
	instanceID, err := parseUUID(r.PathValue("instance_id"))
	if err != nil {
		return err
	}

	detail, err := h.store.GetFindingDetail(r.Context(), instanceID)
	if err != nil {
		return ErrInternal("failed to get finding detail", err)
	}
	if detail == nil {
		return ErrNotFound("not_found", "finding not found")
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": detail})
	return nil
}
