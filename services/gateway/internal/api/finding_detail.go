package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type findingDetailHandler struct {
	store db.Store
}

func (h *findingDetailHandler) get(w http.ResponseWriter, r *http.Request) {
	instanceID, ok := parseUUID(w, r.PathValue("instance_id"))
	if !ok {
		return
	}

	detail, err := h.store.GetFindingDetail(r.Context(), instanceID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "failed to get finding detail")
		return
	}
	if detail == nil {
		writeError(w, http.StatusNotFound, "not_found", "finding not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": detail})
}
