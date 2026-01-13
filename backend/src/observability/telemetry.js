"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTracer = exports.getMeter = exports.getPrometheusMetricsHandler = exports.initTelemetry = void 0;
const api_1 = require("@opentelemetry/api");
const resources_1 = require("@opentelemetry/resources");
const semantic_conventions_1 = require("@opentelemetry/semantic-conventions");
const sdk_metrics_1 = require("@opentelemetry/sdk-metrics");
const exporter_prometheus_1 = require("@opentelemetry/exporter-prometheus");
const sdk_trace_node_1 = require("@opentelemetry/sdk-trace-node");
const sdk_trace_base_1 = require("@opentelemetry/sdk-trace-base");
const exporter_trace_otlp_http_1 = require("@opentelemetry/exporter-trace-otlp-http");
let prometheusExporter = null;
let initialized = false;
function initTelemetry() {
    if (initialized)
        return;
    initialized = true;
    const serviceName = process.env.OTEL_SERVICE_NAME || "stronghold-backend";
    const resource = new resources_1.Resource({
        [semantic_conventions_1.SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    });
    prometheusExporter = new exporter_prometheus_1.PrometheusExporter({ preventServerStart: true });
    const meterProvider = new sdk_metrics_1.MeterProvider({ resource });
    meterProvider.addMetricReader(prometheusExporter);
    api_1.metrics.setGlobalMeterProvider(meterProvider);
    const tracerProvider = new sdk_trace_node_1.NodeTracerProvider({ resource });
    tracerProvider.addSpanProcessor(new sdk_trace_base_1.BatchSpanProcessor(new exporter_trace_otlp_http_1.OTLPTraceExporter()));
    tracerProvider.register();
}
exports.initTelemetry = initTelemetry;
function getPrometheusMetricsHandler() {
    if (!prometheusExporter) {
        throw new Error("Telemetry has not been initialized");
    }
    return prometheusExporter.getMetricsRequestHandler();
}
exports.getPrometheusMetricsHandler = getPrometheusMetricsHandler;
function getMeter() {
    return api_1.metrics.getMeter("stronghold-backend");
}
exports.getMeter = getMeter;
function getTracer() {
    return api_1.trace.getTracer("stronghold-backend");
}
exports.getTracer = getTracer;
