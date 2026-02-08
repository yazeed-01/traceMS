"""
Enricher: adds metadata (timestamp, id). Returns payload for next step (gateway orchestrates).
"""
import os
import time
import uuid
from datetime import datetime, timezone
from fastapi import FastAPI
from pydantic import BaseModel
from opentelemetry import trace

app = FastAPI(title="Enricher")

from shared.tracing import init_tracing, flush_traces
init_tracing(os.environ.get("OTEL_SERVICE_NAME", "enricher"), app)

STEP_DELAY_SECONDS = float(os.environ.get("STEP_DELAY_SECONDS", "2.0"))


class ProcessBody(BaseModel):
    payload: dict = {}
    text: str = ""
    steps: list = []


def _get_data(body: ProcessBody) -> tuple[str, str]:
    if body.payload and isinstance(body.payload, dict):
        return (str(body.payload.get("data", body.payload.get("text", body.text or ""))).strip(), body.payload.get("type", "text"))
    return ((body.text or "").strip(), "text")


@app.get("/health")
def health():
    return {"status": "ok", "service": "enricher"}


@app.post("/")
def enrich(body: ProcessBody):
    time.sleep(STEP_DELAY_SECONDS)
    span = trace.get_current_span()
    data, payload_type = _get_data(body)
    span.set_attribute("process.input.text", data[:200])

    enriched_text = data
    meta = {
        "timestamp": datetime.now(tz=timezone.utc).isoformat(),
        "id": str(uuid.uuid4()),
    }
    preview = data[:200] if payload_type == "text" else f"[{payload_type}]"
    step = {"service": "enricher", "input": preview, "output": preview, "status": "ok", "metadata": meta}
    new_steps = body.steps + [step]
    out_payload = body.payload if body.payload else {}
    out_payload = {**out_payload, "type": payload_type, "data": enriched_text, "metadata": {**out_payload.get("metadata", {}), **meta}}

    span.set_attribute("process.output.text", enriched_text[:200])
    span.set_attribute("process.status", "ok")
    flush_traces()
    return {"payload": out_payload, "text": enriched_text, "steps": new_steps}
