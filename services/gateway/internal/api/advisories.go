package api

import (
	"net/http"
	"strings"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
)

type advisoriesHandler struct {
	store db.Store
}

// The findings list returns one row per instance, so a widely deployed advisory
// fills the top of it. This endpoint collapses those into one row per advisory;
// the filters are applied to the instances before aggregation, so the counts
// always describe exactly what `/findings` would return for the same query.
func (h *advisoriesHandler) list(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	q := r.URL.Query()
	filters, err := parseFindingFilters(projectID, q)
	if err != nil {
		return err
	}
	params := db.AdvisoryParams{FindingFilters: filters, Limit: parseLimit(r, 50, 200)}

	params.Sort, params.SortDesc, err = parseAdvisorySort(q.Get("sort"), q.Get("order"))
	if err != nil {
		return err
	}

	params.Cursor, err = parseAdvisoryCursor(q.Get("cursor"), params.Sort, params.SortDesc)
	if err != nil {
		return err
	}

	groups, hasMore, err := h.store.ListAdvisories(r.Context(), params)
	if err != nil {
		return ErrInternal("failed to list advisories", err)
	}

	resp := PagedResponse[db.AdvisoryGroup]{
		Data:    groups,
		HasMore: hasMore,
	}
	if hasMore && len(groups) > 0 {
		c := encodeAdvisoryCursor(params.Sort, params.SortDesc, groups[len(groups)-1])
		resp.NextCursor = &c
	}

	writeJSON(w, http.StatusOK, resp)
	return nil
}

func parseAdvisorySort(sortParam, orderParam string) (db.SortKey, bool, error) {
	key := db.DefaultAdvisorySortKey
	if sortParam != "" {
		parsed, ok := db.ParseAdvisorySortKey(sortParam)
		if !ok {
			return "", false, ErrBadRequest("invalid_sort",
				"unsupported sort: "+sortParam+" (allowed: "+strings.Join(db.AdvisorySortKeys(), ", ")+")")
		}
		key = parsed
	}
	desc, err := parseOrder(orderParam, db.AdvisoryDefaultDescending(key))
	return key, desc, err
}
