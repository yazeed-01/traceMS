"""
Validator: validates input (non-empty, length). Returns payload for next step (gateway orchestrates).
"""
import os
import time
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from opentelemetry import trace

app = FastAPI(title="Validator")

from shared.tracing import init_tracing, flush_traces
init_tracing(os.environ.get("OTEL_SERVICE_NAME", "validator"), app)

MAX_LENGTH = 10_000
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
    return {"status": "ok", "service": "validator"}


@app.post("/")
def validate(body: ProcessBody):
    time.sleep(STEP_DELAY_SECONDS)
    span = trace.get_current_span()
    data, payload_type = _get_data(body)
    span.set_attribute("process.input.text", data[:200])

    text = data
    if not text:
        span.set_attribute("process.status", "invalid")
        raise HTTPException(status_code=400, detail="Input must be non-empty")
    if payload_type == "text" and len(text) > MAX_LENGTH:
        span.set_attribute("process.status", "invalid")
        raise HTTPException(status_code=400, detail=f"Text length must be <= {MAX_LENGTH}")

    step = {"service": "validator", "input": data[:500] if payload_type == "text" else f"[{payload_type}]", "output": text[:500] if payload_type == "text" else f"[{payload_type}]", "status": "ok"}
    span.set_attribute("process.output.text", text)
    span.set_attribute("process.status", "ok")
    flush_traces()
    out_payload = body.payload if body.payload else {}
    out_payload = {**out_payload, "type": payload_type, "data": text, "metadata": out_payload.get("metadata", {})}
    return {"payload": out_payload, "text": text, "steps": body.steps + [step]}
