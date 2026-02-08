package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/trace"
)

// postWithTrace performs a POST with the current trace context injected so downstream services continue the same trace.
func postWithTrace(ctx context.Context, client *http.Client, url, contentType string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, "POST", url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", contentType)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(req.Header))
	return client.Do(req)
}

func flushTracer() {
	if p, ok := otel.GetTracerProvider().(*trace.TracerProvider); ok {
		_ = p.ForceFlush(context.Background())
	}
}

func svcIcon(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "•"
	}
	return s
}

const (
	jaegerBase = "http://localhost:16686"
)

// ProcessRequestLegacy is { "text": "..." }.
type ProcessRequestLegacy struct {
	Text *string `json:"text"`
}

// ProcessRequest is { "type", "data", "metadata" }.
type ProcessRequest struct {
	Type     string            `json:"type"`
	Data     string            `json:"data"`
	Metadata map[string]interface{} `json:"metadata"`
}

// PipelineServiceUpdate is one service in PUT /api/pipeline.
type PipelineServiceUpdate struct {
	Name        string  `json:"name"`
	URL         string  `json:"url"`
	Icon        string  `json:"icon"`
	Description string  `json:"description"`
	InputType   *string `json:"input_type"`
	OutputType  *string `json:"output_type"`
}

// PipelineUpdate is PUT /api/pipeline body.
type PipelineUpdate struct {
	Services []PipelineServiceUpdate `json:"services"`
}

func apiPipelineGet(w http.ResponseWriter, r *http.Request) {
	svc := LoadPipeline()
	type svcOut struct {
		Name        string `json:"name"`
		URL         string `json:"url"`
		Icon        string `json:"icon"`
		Description string `json:"description"`
		InputType   string `json:"input_type"`
		OutputType  string `json:"output_type"`
	}
	out := make([]svcOut, len(svc))
	for i := range svc {
		out[i] = svcOut{
			Name:        svc[i].Name,
			URL:         svc[i].URL,
			Icon:        svcIcon(svc[i].Icon),
			Description: svc[i].Description,
			InputType:   svc[i].InputType,
			OutputType:  svc[i].OutputType,
		}
	}
	replyJSON(w, map[string]interface{}{"services": out})
}

func apiPipelinePut(w http.ResponseWriter, r *http.Request) {
	var body PipelineUpdate
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		replyJSON(w, map[string]interface{}{"ok": false, "detail": "Invalid JSON"})
		return
	}
	if len(body.Services) == 0 {
		replyJSON(w, map[string]interface{}{"ok": false, "detail": "At least one service required"})
		return
	}
	seen := make(map[string]bool)
	svc := make([]PipelineService, 0, len(body.Services))
	for _, s := range body.Services {
		name := strings.TrimSpace(s.Name)
		if name == "" {
			replyJSON(w, map[string]interface{}{"ok": false, "detail": "Service name is required"})
			return
		}
		if seen[name] {
			replyJSON(w, map[string]interface{}{"ok": false, "detail": "Duplicate service name: " + name})
			return
		}
		seen[name] = true
		icon := strings.TrimSpace(s.Icon)
		if icon == "" {
			icon = "•"
		}
		desc := strings.TrimSpace(s.Description)
		var inputType, outputType string
		if s.InputType != nil {
			inputType = strings.TrimSpace(*s.InputType)
		}
		if s.OutputType != nil {
			outputType = strings.TrimSpace(*s.OutputType)
		}
		svc = append(svc, PipelineService{
			Name:        name,
			URL:         NormalizeURL(s.URL),
			Icon:        icon,
			Description: desc,
			InputType:   inputType,
			OutputType:  outputType,
		})
	}
	err := SetPipeline(svc)
	if err != nil {
		replyJSON(w, map[string]interface{}{"ok": true, "saved": false, "detail": err.Error()})
		return
	}
	saved := getWritablePath() != ""
	replyJSON(w, map[string]interface{}{"ok": true, "saved": saved})
}

func health(w http.ResponseWriter, r *http.Request) {
	replyJSON(w, map[string]string{"status": "ok", "service": "gateway"})
}

func healthAll(w http.ResponseWriter, r *http.Request) {
	results := []map[string]interface{}{
		{"name": "gateway", "ok": true, "body": map[string]string{"status": "ok", "service": "gateway"}},
	}
	client := &http.Client{Timeout: 2 * time.Second}
	for _, pair := range PipelineNamesURLs() {
		name, baseURL := pair[0], pair[1]
		resp, err := client.Get(baseURL + "/health")
		entry := map[string]interface{}{"name": name}
		if err != nil {
			entry["ok"] = false
			entry["body"] = map[string]string{"error": err.Error()}
		} else {
			entry["ok"] = resp.StatusCode >= 200 && resp.StatusCode < 300
			var body map[string]interface{}
			_ = json.NewDecoder(resp.Body).Decode(&body)
			resp.Body.Close()
			entry["body"] = body
		}
		results = append(results, entry)
	}
	replyJSON(w, map[string]interface{}{"services": results})
}

func processStream(w http.ResponseWriter, r *http.Request) {
	payload, err := parseProcessBody(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		replyJSON(w, map[string]interface{}{"detail": err.Error()})
		return
	}
	tracer := otel.Tracer("gateway")
	ctx, span := tracer.Start(r.Context(), "process/stream")
	defer span.End()
	traceID := span.SpanContext().TraceID().String()

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)

	send := func(event string, data interface{}) {
		writeSSE(w, event, data)
		if flusher != nil {
			flusher.Flush()
		}
	}

	send("started", map[string]interface{}{"trace_id": traceID, "payload": payload})
	current := payload
	steps := []interface{}{}
	client := &http.Client{Timeout: 120 * time.Second}
	for _, pair := range PipelineNamesURLs() {
		name, baseURL := pair[0], pair[1]
		body := bodyForService(current, steps)
		bodyReader := mustJSON(body)
		resp, err := PostWithRetryAndCircuit(ctx, client, baseURL+"/", "application/json", bodyReader, baseURL)
		if err != nil {
			send("error", map[string]interface{}{"service": name, "error": err.Error()})
			return
		}
		if resp.StatusCode != http.StatusOK {
			bodyBytes, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			send("error", map[string]interface{}{"service": name, "error": string(bodyBytes)})
			return
		}
		var data map[string]interface{}
		if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
			resp.Body.Close()
			send("error", map[string]interface{}{"service": name, "error": err.Error()})
			return
		}
		resp.Body.Close()
		current = normalizeIncoming(data)
		if s, ok := data["steps"].([]interface{}); ok {
			steps = s
		}
		lastStep := map[string]interface{}{}
		if len(steps) > 0 {
			if m, ok := steps[len(steps)-1].(map[string]interface{}); ok {
				lastStep = m
			}
		}
		preview := previewPayload(current)
		send("step", map[string]interface{}{
			"service":      name,
			"input":        getStr(lastStep, "input", preview),
			"output":       getStr(lastStep, "output", preview),
			"status":       getStr(lastStep, "status", "ok"),
			"payload_type": getStr(current, "type", "text"),
		})
	}
	flushTracer()
	send("done", map[string]interface{}{
		"trace_id": traceID,
		"result":   current["data"],
		"steps":    steps,
		"payload":  current,
	})
}

func processJSON(w http.ResponseWriter, r *http.Request) {
	payload, err := parseProcessBody(r)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		replyJSON(w, map[string]interface{}{"detail": err.Error()})
		return
	}
	tracer := otel.Tracer("gateway")
	ctx, span := tracer.Start(r.Context(), "process/json")
	defer span.End()
	traceID := span.SpanContext().TraceID().String()
	result := runPipeline(ctx, payload)
	flushTracer()
	replyJSON(w, map[string]interface{}{
		"trace_id": traceID,
		"result":   result["result"],
		"stored":   true,
		"steps":    result["steps"],
		"payload":  result["payload"],
	})
}

func processForm(w http.ResponseWriter, r *http.Request) {
	payload := map[string]interface{}{
		"type":     "text",
		"data":     "",
		"metadata": map[string]interface{}{},
	}
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		mp, err := r.MultipartReader()
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			replyJSON(w, map[string]interface{}{"detail": err.Error()})
			return
		}
		for {
			part, err := mp.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
			name := part.FormName()
			if name == "file" && part.FileName() != "" {
				raw, err := io.ReadAll(part)
				if err != nil {
					continue
				}
				b64 := base64.StdEncoding.EncodeToString(raw)
				contentType := part.Header.Get("Content-Type")
				if contentType == "" {
					contentType = "application/octet-stream"
				}
				ptype := "binary"
				if strings.HasPrefix(contentType, "image/") {
					ptype = "image"
				} else if strings.HasPrefix(contentType, "video/") {
					ptype = "video"
				}
				payload["type"] = ptype
				payload["data"] = b64
				payload["metadata"] = map[string]interface{}{
					"filename":     part.FileName(),
					"content_type": contentType,
				}
				break
			}
			if name == "text" {
				b, _ := io.ReadAll(part)
				payload["type"] = "text"
				payload["data"] = string(b)
				break
			}
			if name == "type" {
				b, _ := io.ReadAll(part)
				payload["type"] = string(b)
			}
			if name == "data" {
				b, _ := io.ReadAll(part)
				payload["data"] = string(b)
			}
			if name == "metadata" {
				b, _ := io.ReadAll(part)
				var m map[string]interface{}
				_ = json.Unmarshal(b, &m)
				payload["metadata"] = m
			}
		}
	} else {
		_ = r.ParseForm()
		if t := r.Form.Get("text"); t != "" {
			payload["data"] = t
		} else if d := r.Form.Get("data"); d != "" {
			payload["type"] = r.Form.Get("type")
			if payload["type"] == "" {
				payload["type"] = "text"
			}
			payload["data"] = d
			meta := r.Form.Get("metadata")
			if meta != "" {
				var m map[string]interface{}
				_ = json.Unmarshal([]byte(meta), &m)
				payload["metadata"] = m
			}
		}
	}
	if payload["data"] == "" && payload["type"] == "text" {
		payload["data"] = r.FormValue("text")
	}
	tracer := otel.Tracer("gateway")
	ctx, span := tracer.Start(r.Context(), "process/form")
	defer span.End()
	traceID := span.SpanContext().TraceID().String()
	result := runPipeline(ctx, payload)
	flushTracer()
	replyJSON(w, map[string]interface{}{
		"trace_id": traceID,
		"result":   result["result"],
		"stored":   true,
		"steps":    result["steps"],
		"payload":  result["payload"],
	})
}

func parseProcessBody(r *http.Request) (map[string]interface{}, error) {
	var raw map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return nil, err
	}
	return normalizeIncomingFromRequest(raw), nil
}

func normalizeIncomingFromRequest(raw map[string]interface{}) map[string]interface{} {
	if p, ok := raw["payload"].(map[string]interface{}); ok {
		return p
	}
	if raw["type"] != nil && raw["data"] != nil {
		meta := raw["metadata"]
		if meta == nil {
			meta = map[string]interface{}{}
		}
		return map[string]interface{}{
			"type":     raw["type"],
			"data":     raw["data"],
			"metadata": meta,
		}
	}
	if t, ok := raw["text"].(string); ok {
		return map[string]interface{}{
			"type":     "text",
			"data":     t,
			"metadata": map[string]interface{}{},
		}
	}
	return map[string]interface{}{
		"type":     "text",
		"data":     "",
		"metadata": map[string]interface{}{},
	}
}

func normalizeIncoming(data map[string]interface{}) map[string]interface{} {
	if p, ok := data["payload"].(map[string]interface{}); ok {
		return p
	}
	t := "text"
	if v, ok := data["type"].(string); ok {
		t = v
	}
	d := ""
	if v, ok := data["data"].(string); ok {
		d = v
	}
	if d == "" {
		if v, ok := data["text"].(string); ok {
			d = v
		}
		if v, ok := data["result"].(string); ok && d == "" {
			d = v
		}
	}
	meta := data["metadata"]
	if meta == nil {
		meta = map[string]interface{}{}
	}
	return map[string]interface{}{"type": t, "data": d, "metadata": meta}
}

func bodyForService(payload map[string]interface{}, steps []interface{}) map[string]interface{} {
	text := ""
	if t, _ := payload["type"].(string); t == "text" {
		text, _ = payload["data"].(string)
	}
	return map[string]interface{}{
		"payload": payload,
		"steps":   steps,
		"text":    text,
	}
}

func runPipeline(ctx context.Context, initial map[string]interface{}) map[string]interface{} {
	payload := initial
	steps := []interface{}{}
	client := &http.Client{Timeout: 120 * time.Second}
	for _, pair := range PipelineNamesURLs() {
		_, baseURL := pair[0], pair[1]
		body := bodyForService(payload, steps)
		bodyReader := mustJSON(body)
		resp, err := PostWithRetryAndCircuit(ctx, client, baseURL+"/", "application/json", bodyReader, baseURL)
		if err != nil {
			return map[string]interface{}{"payload": payload, "steps": steps, "result": payload["data"], "stored": false}
		}
		if resp.StatusCode != http.StatusOK {
			resp.Body.Close()
			return map[string]interface{}{"payload": payload, "steps": steps, "result": payload["data"], "stored": false}
		}
		var data map[string]interface{}
		_ = json.NewDecoder(resp.Body).Decode(&data)
		resp.Body.Close()
		payload = normalizeIncoming(data)
		if s, ok := data["steps"].([]interface{}); ok {
			steps = s
		}
	}
	return map[string]interface{}{
		"payload": payload,
		"steps":   steps,
		"result":  payload["data"],
		"stored":  true,
	}
}

func previewPayload(payload map[string]interface{}) string {
	if payload == nil {
		return ""
	}
	t, _ := payload["type"].(string)
	if t == "" {
		t = "text"
	}
	d, _ := payload["data"].(string)
	if t == "image" || t == "video" || t == "binary" {
		return fmt.Sprintf("[%s] %d chars", t, len(d))
	}
	const maxLen = 80
	if len(d) <= maxLen {
		return d
	}
	return d[:maxLen] + "…"
}

func getStr(m map[string]interface{}, key, def string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

func writeSSE(w io.Writer, event string, data interface{}) {
	jsonBytes, _ := json.Marshal(data)
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, jsonBytes)
}

func replyJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func mustJSON(v interface{}) *bytes.Reader {
	b, _ := json.Marshal(v)
	return bytes.NewReader(b)
}

// RegisterRoutes mounts all handlers on r.
// If staticDir is non-empty, serves static files from that directory (e.g. ../frontend/dist).
// Otherwise serves from embedded StaticFS (Vue app built into binary).
func RegisterRoutes(r chi.Router, staticDir string) {
	r.Get("/api/pipeline", apiPipelineGet)
	r.Put("/api/pipeline", apiPipelinePut)
	r.Get("/health", health)
	r.Get("/health/all", healthAll)
	r.Post("/process/stream", processStream)
	r.Post("/process/json", processJSON)
	r.Post("/process", processForm)
	if staticDir != "" {
		r.Handle("/assets/*", http.StripPrefix("/assets", http.FileServer(http.Dir(staticDir+"/assets"))))
		r.Handle("/favicon.ico", http.FileServer(http.Dir(staticDir)))
		r.Get("/", serveIndexFromDir(staticDir))
	} else {
		sub, _ := fs.Sub(StaticFS, "static")
		root := http.FS(sub)
		assetsFS, _ := fs.Sub(sub, "assets")
		r.Handle("/assets/*", http.StripPrefix("/assets", http.FileServer(http.FS(assetsFS))))
		r.Handle("/favicon.ico", http.FileServer(root))
		r.Get("/", serveIndexFromFS(root))
		r.NotFound(func(w http.ResponseWriter, r *http.Request) {
			// SPA fallback: serve index.html for non-API paths
			r.URL.Path = "/"
			http.FileServer(root).ServeHTTP(w, r)
		})
	}
}

func serveIndexFromDir(staticDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, staticDir+"/index.html")
	}
}

func serveIndexFromFS(root http.FileSystem) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		f, err := root.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		stat, _ := f.Stat()
		if stat != nil && stat.IsDir() {
			http.NotFound(w, r)
			return
		}
		http.ServeContent(w, r, "index.html", stat.ModTime(), f.(io.ReadSeeker))
	}
}
