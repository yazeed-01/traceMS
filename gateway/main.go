package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
)

func main() {
	ctx := context.Background()
	shutdown, err := initTracing(ctx)
	if err != nil {
		log.Printf("Tracing init failed (continuing without): %v", err)
	} else {
		defer shutdown()
	}

	staticDir := os.Getenv("STATIC_DIR")
	// When empty: use embedded Vue app (Docker build). Set STATIC_DIR e.g. to ../frontend/dist for local dev.
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			next.ServeHTTP(w, req)
		})
	})
	RegisterRoutes(r, staticDir)

	addr := ":" + port
	staticSource := "embedded"
	if staticDir != "" {
		staticSource = staticDir
	}
	log.Printf("TraceMS gateway listening on %s (static: %s)", addr, staticSource)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}
