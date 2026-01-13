import { metrics, trace } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { MeterProvider } from "@opentelemetry/sdk-metrics";
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

let prometheusExporter: PrometheusExporter | null = null;
let initialized = false;

export function initTelemetry() {
  if (initialized) return;
  initialized = true;

  const serviceName = process.env.OTEL_SERVICE_NAME || "stronghold-backend";
  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
  });

  prometheusExporter = new PrometheusExporter({ preventServerStart: true });
  const meterProvider = new MeterProvider({ resource });
  meterProvider.addMetricReader(prometheusExporter);
  metrics.setGlobalMeterProvider(meterProvider);

  const tracerProvider = new NodeTracerProvider({ resource });
  tracerProvider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter()));
  tracerProvider.register();
}

export function getPrometheusMetricsHandler() {
  if (!prometheusExporter) {
    throw new Error("Telemetry has not been initialized");
  }
  return prometheusExporter.getMetricsRequestHandler();
}

export function getMeter() {
  return metrics.getMeter("stronghold-backend");
}

export function getTracer() {
  return trace.getTracer("stronghold-backend");
}
