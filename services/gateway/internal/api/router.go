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
	mux.HandleFunc("GET /api/projects", ph.list)

	th := &targetsHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/targets", th.list)

	fh := &findingsHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/findings", fh.list)

	fdh := &findingDetailHandler{store: store}
	mux.HandleFunc("GET /api/findings/{instance_id}", fdh.get)

	trh := &topRisksHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/top-risks", trh.list)

	tlh := &timelineHandler{store: store}
	mux.HandleFunc("GET /api/projects/{id}/timeline", tlh.list)

	// SSE
	sh := sse.NewHandler(broker)
	mux.HandleFunc("GET /api/events", sh.ServeHTTP)

	// Middleware chain: recovery → logging → cors → mux
	var handler http.Handler = mux
	handler = corsMiddleware(handler)
	handler = loggingMiddleware(handler)
	handler = recoveryMiddleware(handler)

	return handler
}
