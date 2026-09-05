package api

import (
	"net/http"

	"github.com/Kaikei-e/decree/services/gateway/internal/db"
	"github.com/Kaikei-e/decree/services/gateway/internal/sse"
)

func NewRouter(store db.Store, broker *sse.Broker) http.Handler {
	mux := http.NewServeMux()

	// Health
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "decree-gateway"})
	})

	// REST API
	ph := &projectsHandler{store: store}
	mux.HandleFunc("GET /api/projects", handleApp(ph.list))
	mux.HandleFunc("GET /api/projects/{id}", handleApp(ph.get))

	th := &targetsHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/targets", handleApp(th.list))

	fh := &findingsHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/findings", handleApp(fh.list))

	ah := &advisoriesHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/advisories", handleApp(ah.list))

	fdh := &findingDetailHandler{store: store}
	mux.HandleFunc("GET /api/findings/{instance_id}", handleApp(fdh.get))

	fch := &facetsHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/facets", handleApp(fch.get))

	trh := &topRisksHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/top-risks", handleApp(trh.list))

	tlh := &timelineHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/timeline", handleApp(tlh.list))

	// SSE
	sh := sse.NewHandler(broker)
	mux.HandleFunc("GET /api/events", sh.ServeHTTP)

	// Middleware chain: recovery → requestID → logging → cors → mux
	var handler http.Handler = mux
	handler = corsMiddleware(handler)
	handler = loggingMiddleware(handler)
	handler = requestIDMiddleware(handler)
	handler = recoveryMiddleware(handler)

	return handler
}
