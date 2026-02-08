"""
Transformer: transforms text (e.g. uppercase). Returns payload for next step (gateway orchestrates).
"""
import os
import time
from fastapi import FastAPI
from pydantic import BaseModel
from opentelemetry import trace

app = FastAPI(title="Transformer")

from shared.tracing import init_tracing, flush_traces
init_tracing(os.environ.get("OTEL_SERVICE_NAME", "transformer"), app)

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
    return {"status": "ok", "service": "transformer"}


@app.post("/")
def transform(body: ProcessBody):
    time.sleep(STEP_DELAY_SECONDS)
    span = trace.get_current_span()
    data, payload_type = _get_data(body)
    span.set_attribute("process.input.text", data[:200])

    transformed = data.upper().strip() if payload_type == "text" else data
    step = {"service": "transformer", "input": data, "output": transformed, "status": "ok"}
    span.set_attribute("process.output.text", transformed[:200])
    span.set_attribute("process.status", "ok")
    flush_traces()
    out_payload = body.payload if body.payload else {}
    out_payload = {**out_payload, "type": payload_type, "data": transformed, "metadata": out_payload.get("metadata", {})}
    return {"payload": out_payload, "text": transformed, "steps": body.steps + [step]}
