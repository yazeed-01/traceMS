# TraceMS – Microservices pipeline with Jaeger and OpenTelemetry

A config-driven pipeline for any number of microservices. Track requests with OpenTelemetry and Jaeger. Supports text, JSON, images, video, and binary. The dashboard lets you configure services, run the pipeline, and see per-step input/output.

## How to run

**With Docker (recommended):**

```bash
docker compose up --build
```

- **Dashboard:** http://localhost:8080  
- **Jaeger UI:** http://localhost:16686  

**Without Docker:** Build the frontend, then run the Go gateway (see [Build and run locally](#build-and-run-locally-without-docker)).

---

## Architecture

- **Gateway** (Go, port 8080): Entry point; serves the Vue dashboard (embedded or from disk), loads pipeline from YAML, and orchestrates the pipeline (calls each service in order). Supports form, JSON, and file upload; forwards a unified payload through the chain.
- **Frontend** (Vue 3 + Vite + TypeScript): Dashboard UI; built into the gateway binary when using Docker, or run separately with `npm run dev` and proxy to the gateway.
- **Microservices** (Python): Validator (8001), Transformer (8002), Enricher (8003), Persister (8004). Unchanged; each has `main.py`, `requirements.txt`, and `Dockerfile`; tracing is in `shared/tracing.py`.

Flow: **Gateway → [Validator → Transformer → Enricher → Persister]** (or whatever you define in `pipeline.yaml`). You can add or remove services by editing the config or via the dashboard.

**Reliability:** The gateway retries failed calls to pipeline services (network errors and HTTP 5xx/429) with exponential backoff, and uses a per-service circuit breaker so repeated failures do not hammer a down service.

**Scalability:** When `WRITABLE_PIPELINE_PATH` is set, the pipeline is file-authoritative: all gateway replicas (e.g. behind a load balancer) read and write the same config file, so they share one pipeline. Use a shared volume or path so every instance sees the same file.

## Run with Docker Compose

```bash
docker compose up --build
```

- **Dashboard:** http://localhost:8080 (configure services, run pipeline, view results)
- **Jaeger UI:** http://localhost:16686 (traces)

The gateway image is built in two stages: Vue frontend first, then Go with the frontend embedded.

## Build and run locally (without Docker)

1. **Gateway (Go)**  
   - With embedded UI (build frontend first):  
     ```bash
     cd frontend && npm ci --ignore-scripts && npm run build-only && cd ..
     cp -r frontend/dist gateway/static
     cd gateway && go build -o gateway . && ./gateway
     ```
   - Or serve frontend from disk (no embed):  
     ```bash
     cd gateway && go build -o gateway . && STATIC_DIR=../frontend/dist ./gateway
     ```
   - Default port: 8080 (set `PORT` to change).

2. **Frontend (dev)**  
   - Run the Vue app with hot reload and proxy to the gateway:  
     ```bash
     cd frontend && npm run dev
     ```
   - Open http://localhost:5173 (or the port Vite prints). The Vite config proxies `/api`, `/process`, and `/health` to `http://localhost:8080`.

3. **Microservices**  
   - Run as usual (e.g. with Docker Compose for the Python services, or run them locally).

## Pipeline config (any number of microservices)

The gateway reads the pipeline from a YAML file so you can plug in **any number of microservices** without code changes.

1. Copy `pipeline.example.yaml` to `pipeline.yaml` (or set `PIPELINE_CONFIG_PATH` to your file).
2. Edit the `services` list: order defines execution order.

Example:

```yaml
services:
  - name: validator
    url: http://validator:8001
    icon: "✓"
    description: Validate input
  - name: transformer
    url: http://transformer:8002
    icon: "⇅"
    description: Transform content
  - name: enricher
    url: http://enricher:8003
    icon: "⊕"
    description: Add metadata
  - name: persister
    url: http://persister:8004
    icon: "💾"
    description: Persist result
```

- **name**: Service identifier (used in dashboard and traces).
- **url**: Base URL of the service (must expose `POST /` and `GET /health`).
- **icon**, **description**: Optional; used by the dashboard.

If no config file is found, the gateway falls back to the default four services above using env vars (`VALIDATOR_URL`, etc.).

## Service contract (for your own microservices)

Each microservice in the pipeline must:

1. **Accept** `POST /` with JSON body:
   - `payload`: `{ "type": "<text|json|image|video|binary>", "data": "<string or base64>", "metadata": {} }`
   - `text`: Legacy; same as `payload.data` when type is text.
   - `steps`: Array of previous steps (append to it, don't replace).

2. **Return** JSON:
   - `payload`: Updated payload (same shape: `type`, `data`, `metadata`).
   - `text`: Optional; same as `payload.data` for text type.
   - `steps`: `body.steps` plus the new step: `{ "service": "<name>", "input": "<preview>", "output": "<preview>", "status": "ok" }`.

For large or binary payloads, put a short **preview** in `step.input` / `step.output` (e.g. first 200 chars or `[image]`) so the dashboard stays readable.

**Payload types:**

| type    | data content        | typical use      |
|---------|---------------------|------------------|
| text    | plain string        | text processing  |
| json    | JSON string         | structured data  |
| image   | base64              | images           |
| video   | base64              | video blobs      |
| binary  | base64              | any file         |

The gateway normalizes incoming requests (form text, JSON body, or file upload) into this payload and passes it through the pipeline unchanged in shape; services can read `payload.type` and `payload.data` and return an updated `payload` + `steps`.

## Usage

1. **Dashboard** (http://localhost:8080): Open **Configure microservices** to add/edit pipeline services (name, URL, input/output types). Choose input type (Text, JSON, Image, Video, File), enter content or pick a file, then **Run pipeline**. The pipeline is loaded from `GET /api/pipeline` (dynamic stations). You see the request move through each station with per-step input/output; result is rendered by type.
2. **Jaeger**: Use service `gateway` (or any service name) and **Find Traces**, or paste the Trace ID from the result.
3. **Health**: `GET /health/all` for all services.

**If "trace not found" in Jaeger:** Traces are sent via **Jaeger Thrift HTTP** (port 14268) by default. Rebuild and restart, then run a new request. For OTLP set `TRACE_EXPORTER=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318`.

## Environment

Copy `.env.example` to `.env`. Main variables:

- **Gateway:** `PORT` (default 8080), `PIPELINE_CONFIG_PATH` (default `/app/pipeline.yaml`), `WRITABLE_PIPELINE_PATH` (optional; if set, `PUT /api/pipeline` persists to this file and pipeline is file-authoritative for multiple replicas). `STATIC_DIR`: if set (e.g. `../frontend/dist`), serve frontend from disk instead of embedded. `VALIDATOR_URL`, `TRANSFORMER_URL`, etc. used when no pipeline YAML is found.
- **Reliability (gateway):** `PIPELINE_MAX_RETRIES` (default 3), `PIPELINE_RETRY_BACKOFF_MS` (default 100), `PIPELINE_CIRCUIT_FAILURE_THRESHOLD` (default 5), `PIPELINE_CIRCUIT_WINDOW_SEC` (default 30), `PIPELINE_CIRCUIT_COOLDOWN_SEC` (default 30). Retries apply to pipeline service calls; the circuit breaker opens after that many failures within the window and stops calling the service for the cooldown period.
- **Microservices:** `STEP_DELAY_SECONDS` (default `2`) for demo effect; Jaeger/OTEL vars as needed.

## API

- **GET /api/pipeline**: Returns `{ "services": [ { "name", "url", "icon", "description", "input_type", "output_type" }, ... ] }` for the dashboard.
- **PUT /api/pipeline**: Body `{ "services": [ ... ] }`; updates pipeline (optionally persisted if `WRITABLE_PIPELINE_PATH` is set).
- **POST /process**: Form or multipart. Fields: `text`, or `type`+`data`+`metadata`, or `file`. Returns `{ "trace_id", "result", "stored", "steps", "payload" }`.
- **POST /process/json**: JSON body: `{ "text": "..." }` or `{ "type", "data", "metadata" }`. Same response.
- **POST /process/stream**: Same JSON body; response is Server-Sent Events (`started`, `step`, `error`, `done`) for the real-time dashboard.
- **GET /health**, **GET /health/all**: Health of gateway and all pipeline services.
- **GET /** Serves the dashboard (Vue app).

## Project layout

```
traceMS/
├── docker-compose.yml
├── pipeline.example.yaml   # Pipeline config template
├── .env.example
├── frontend/               # Vue 3 + Vite + TypeScript dashboard
│   ├── src/
│   │   ├── App.vue
│   │   ├── api.ts
│   │   ├── types.ts
│   │   └── assets/
│   └── dist/               # Build output (copied into gateway/static for embed)
├── gateway/                # Go gateway; serves dashboard at /
│   ├── main.go
│   ├── config.go
│   ├── handlers.go
│   ├── circuitbreaker.go   # Per-service circuit breaker
│   ├── httputil.go         # Retry + circuit-aware HTTP client
│   ├── static_embed.go
│   ├── static/             # Placeholder or Vue build output for embed
│   └── Dockerfile          # Multi-stage: Vue build → Go with embed
├── shared/
│   └── tracing.py          # Used by Python microservices
└── microservices/
    ├── validator/
    ├── transformer/
    ├── enricher/
    └── persister/
```

Microservices remain Python; the gateway is Go and the dashboard is Vue 3.
