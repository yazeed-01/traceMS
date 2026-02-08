"""
OpenTelemetry bootstrap: export to Jaeger via Thrift HTTP (collector 14268) or OTLP (4317/4318).
Using Jaeger Thrift HTTP by default so traces reliably appear in Jaeger UI.
See https://www.jaegertracing.io/docs/2.15/architecture/
"""
import os
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

# Default: Jaeger Thrift HTTP (collector 14268). Set TRACE_EXPORTER=otlp and OTEL_EXPORTER_OTLP_ENDPOINT to use OTLP.
_jaeger_collector = os.environ.get("JAEGER_COLLECTOR_ENDPOINT", "http://jaeger:14268/api/traces")
_otlp_endpoint = os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") or os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "http://jaeger:4318")
_use_otlp = os.environ.get("TRACE_EXPORTER", "").lower() == "otlp"


def _create_jaeger_thrift_exporter():
    from opentelemetry.exporter.jaeger.thrift import JaegerExporter
    endpoint = _jaeger_collector.rstrip("/")
    if "format=" not in endpoint:
        endpoint = f"{endpoint}?format=jaeger.thrift"
    return JaegerExporter(
        collector_endpoint=endpoint,
        agent_host_name=None,
        agent_port=None,
    )


def _create_otlp_exporter():
    _endpoint = _otlp_endpoint or "http://jaeger:4318"
    _use_grpc = "4317" in _endpoint
    if _use_grpc:
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
        endpoint = _endpoint.replace("https://", "").replace("http://", "").split("/")[0]
        return OTLPSpanExporter(endpoint=endpoint)
    else:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        endpoint = _endpoint.replace("https://", "").replace("http://", "").split("/")[0]
        return OTLPSpanExporter(endpoint="http://" + endpoint)


def init_tracing(service_name: str, app=None):
    """Initialize tracing for this service. Call at startup."""
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    exporter = _create_otlp_exporter() if _use_otlp else _create_jaeger_thrift_exporter()
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    HTTPXClientInstrumentor().instrument()
    if app is not None:
        FastAPIInstrumentor.instrument_app(app)
    return trace.get_tracer(service_name, "1.0.0")


def flush_traces(timeout_millis: int = 5000) -> None:
    """Force flush span processor so traces are sent to Jaeger before returning trace_id to user."""
    provider = trace.get_tracer_provider()
    if isinstance(provider, TracerProvider):
        provider.force_flush(timeout_millis=timeout_millis)
