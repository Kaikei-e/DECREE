package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type facetsHandler struct {
	store db.Store
}

// Facets are deliberately blind to severity/ecosystem/q so the frontend's filter
// options stay stable instead of collapsing to the current result set.
func (h *facetsHandler) get(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	facets, err := h.store.GetFindingFacets(r.Context(), projectID,
		r.URL.Query().Get("active_only") == "true")
	if err != nil {
		return ErrInternal("failed to get facets", err)
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": facets})
	return nil
}
