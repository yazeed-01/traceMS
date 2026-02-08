"""
Persister: last step in the pipeline. Simulates persistence and returns final output.
"""
import os
import time
from fastapi import FastAPI
from pydantic import BaseModel
from opentelemetry import trace

app = FastAPI(title="Persister")

STEP_DELAY_SECONDS = float(os.environ.get("STEP_DELAY_SECONDS", "2.0"))

# Tracing must be initialized after app creation for FastAPI instrumentation
from shared.tracing import init_tracing, flush_traces
init_tracing(os.environ.get("OTEL_SERVICE_NAME", "persister"), app)


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
    return {"status": "ok", "service": "persister"}


@app.post("/")
def persist(body: ProcessBody):
    time.sleep(STEP_DELAY_SECONDS)
    span = trace.get_current_span()
    data, payload_type = _get_data(body)
    span.set_attribute("process.input.text", data[:200])
    span.set_attribute("process.input.steps_count", len(body.steps))

    step = {"service": "persister", "input": data, "output": data, "status": "ok"}
    out_payload = body.payload if body.payload else {}
    out_payload = {**out_payload, "type": payload_type, "data": data, "metadata": out_payload.get("metadata", {})}
    result = {
        "result": data,
        "stored": True,
        "payload": out_payload,
        "steps": body.steps + [step],
    }
    span.set_attribute("process.output.result", data[:200])
    span.set_attribute("process.status", "ok")
    flush_traces()
    return result
