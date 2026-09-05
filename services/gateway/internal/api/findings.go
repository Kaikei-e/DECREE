package api

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/google/uuid"
)

type findingsHandler struct {
	store db.Store
}

// Sort direction convention: `?sort=<key>&order=asc|desc`. Prefixed forms such
// as `sort=-severity` are not accepted. Omitting `order` uses the key's default
// (descending for score/severity/epss/cvss/last_observed, ascending otherwise).
func (h *findingsHandler) list(w http.ResponseWriter, r *http.Request) error {
	projectID, err := parseUUID(r.PathValue("id"))
	if err != nil {
		return err
	}

	q := r.URL.Query()
	filters, err := parseFindingFilters(projectID, q)
	if err != nil {
		return err
	}
	params := db.FindingParams{FindingFilters: filters, Limit: parseLimit(r, 50, 200)}

	params.Sort, params.SortDesc, err = parseSort(q.Get("sort"), q.Get("order"))
	if err != nil {
		return err
	}

	params.Cursor, err = parseFindingCursor(q.Get("cursor"), params.Sort, params.SortDesc)
	if err != nil {
		return err
	}

	findings, hasMore, err := h.store.ListFindings(r.Context(), params)
	if err != nil {
		return ErrInternal("failed to list findings", err)
	}

	resp := PagedResponse[db.Finding]{
		Data:    findings,
		HasMore: hasMore,
	}
	if hasMore && len(findings) > 0 {
		c := encodeFindingCursor(params.Sort, params.SortDesc, findings[len(findings)-1])
		resp.NextCursor = &c
	}

	writeJSON(w, http.StatusOK, resp)
	return nil
}

// parseFindingFilters reads the filter parameters shared by the findings list
// and the advisory grouping, so both narrow the instance set identically.
func parseFindingFilters(projectID uuid.UUID, q url.Values) (db.FindingFilters, error) {
	filters := db.FindingFilters{
		ProjectID:  projectID,
		ActiveOnly: q.Get("active_only") == "true",
	}

	if v := q.Get("severity"); v != "" {
		lower := strings.ToLower(v)
		filters.Severity = &lower
	}
	if v := q.Get("ecosystem"); v != "" {
		filters.Ecosystem = &v
	}
	if v := strings.TrimSpace(q.Get("advisory")); v != "" {
		filters.Advisory = &v
	}
	if v := q.Get("min_epss"); v != "" {
		f, err := strconv.ParseFloat(v, 32)
		if err == nil {
			f32 := float32(f)
			filters.MinEPSS = &f32
		}
	}
	if v := strings.TrimSpace(q.Get("q")); v != "" {
		if utf8.RuneCountInString(v) > db.MaxSearchLength {
			return filters, ErrBadRequest("invalid_query",
				"q exceeds "+strconv.Itoa(db.MaxSearchLength)+" characters")
		}
		filters.Query = &v
	}
	return filters, nil
}

func parseSort(sortParam, orderParam string) (db.SortKey, bool, error) {
	key := db.DefaultSortKey
	if sortParam != "" {
		parsed, ok := db.ParseSortKey(sortParam)
		if !ok {
			return "", false, ErrBadRequest("invalid_sort",
				"unsupported sort: "+sortParam+" (allowed: "+strings.Join(db.SortKeys(), ", ")+")")
		}
		key = parsed
	}
	desc, err := parseOrder(orderParam, key.DefaultDescending())
	return key, desc, err
}

func parseOrder(orderParam string, defaultDesc bool) (bool, error) {
	switch orderParam {
	case "":
		return defaultDesc, nil
	case "asc":
		return false, nil
	case "desc":
		return true, nil
	}
	return false, ErrBadRequest("invalid_order", "unsupported order: "+orderParam+" (allowed: asc, desc)")
}
