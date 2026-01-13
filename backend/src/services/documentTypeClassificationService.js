"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.__test__ = void 0;
exports.classifyDocumentTypeWithModel = classifyDocumentTypeWithModel;
const DEFAULT_LABELS = [
    "ARCHI",
    "BACKUP_POLICY",
    "SLA",
    "RUNBOOK",
    "CMDB",
    "CONTRACT",
    "RISK",
    "POLICY",
];
const DEFAULT_MAX_CHARS = 8000;
function clampScore(score) {
    if (typeof score !== "number" || Number.isNaN(score))
        return 0;
    return Math.min(1, Math.max(0, score));
}
function resolveLabels() {
    const raw = process.env.DOC_CLASSIFICATION_LABELS;
    if (!raw)
        return DEFAULT_LABELS;
    const labels = raw
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    return labels.length > 0 ? labels : DEFAULT_LABELS;
}
function resolveLabelMap() {
    const raw = process.env.DOC_CLASSIFICATION_LABEL_MAP;
    if (!raw)
        return {};
    try {
        const parsed = JSON.parse(raw);
        return Object.entries(parsed).reduce((acc, [key, value]) => {
            acc[key.toLowerCase()] = value.toUpperCase();
            return acc;
        }, {});
    }
    catch (_err) {
        return {};
    }
}
function normalizeLabel(label, labelMap) {
    const trimmed = label.trim();
    if (!trimmed)
        return null;
    const mapped = labelMap[trimmed.toLowerCase()];
    const normalized = (mapped ?? trimmed).toUpperCase();
    const allowed = resolveLabels();
    return allowed.includes(normalized) ? normalized : null;
}
function pickBestPrediction(payload) {
    if (Array.isArray(payload)) {
        const sorted = payload
            .filter((item) => item && typeof item.label === "string")
            .sort((a, b) => clampScore(b.score) - clampScore(a.score));
        return sorted[0] ? { label: sorted[0].label, score: clampScore(sorted[0].score) } : null;
    }
    if (payload && typeof payload === "object") {
        const record = payload;
        if (typeof record.label === "string" && typeof record.score === "number") {
            return { label: record.label, score: clampScore(record.score) };
        }
        const labels = Array.isArray(record.labels) ? record.labels : null;
        const scores = Array.isArray(record.scores) ? record.scores : null;
        if (labels && scores && labels.length > 0 && labels.length === scores.length) {
            const combined = labels.map((label, index) => ({ label, score: clampScore(scores[index]) }));
            combined.sort((a, b) => b.score - a.score);
            return combined[0] ?? null;
        }
        if (Array.isArray(record.predictions)) {
            const predictions = record.predictions;
            if (predictions.length > 0) {
                const sorted = predictions.sort((a, b) => clampScore(b.score) - clampScore(a.score));
                return { label: sorted[0].label, score: clampScore(sorted[0].score) };
            }
        }
    }
    return null;
}
function truncateText(text) {
    const maxChars = Number(process.env.DOC_CLASSIFICATION_MAX_CHARS || DEFAULT_MAX_CHARS);
    const limit = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : DEFAULT_MAX_CHARS;
    if (text.length <= limit)
        return text;
    return text.slice(0, limit);
}
function buildClassifierPayload(text, labels) {
    const mode = (process.env.DOC_CLASSIFICATION_MODE || "zero-shot").toLowerCase();
    if (mode === "zero-shot") {
        return {
            inputs: text,
            parameters: {
                candidate_labels: labels,
                multi_label: false,
            },
        };
    }
    return { inputs: text };
}
async function callClassifierEndpoint(payload, signal) {
    const endpoint = process.env.DOC_CLASSIFICATION_ENDPOINT;
    if (!endpoint) {
        throw new Error("DOC_CLASSIFICATION_ENDPOINT is not configured");
    }
    const headers = { "Content-Type": "application/json" };
    const apiKey = process.env.DOC_CLASSIFICATION_API_KEY;
    if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
    });
    if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(`Classifier request failed: ${response.status} ${message}`);
    }
    return response.json();
}
async function classifyDocumentTypeWithModel(params) {
    const provided = (params.providedDocType || "").trim();
    if (provided.length >= 3) {
        return {
            type: provided.toUpperCase(),
            confidence: 0.9,
            reasons: ["Type fourni par l'utilisateur"],
        };
    }
    const endpoint = process.env.DOC_CLASSIFICATION_ENDPOINT;
    if (!endpoint) {
        return {
            type: "UNKNOWN",
            confidence: 0.2,
            reasons: ["Aucun modèle ML configuré"],
        };
    }
    const labels = resolveLabels();
    const labelMap = resolveLabelMap();
    const provider = process.env.DOC_CLASSIFICATION_PROVIDER || "ml";
    const modelName = process.env.DOC_CLASSIFICATION_MODEL || "bert";
    const contentParts = [params.fileName ? `filename:${params.fileName}` : null, params.text].filter(Boolean);
    const payloadText = truncateText(contentParts.join("\n\n"));
    const payload = buildClassifierPayload(payloadText, labels);
    const timeoutMs = Number(process.env.DOC_CLASSIFICATION_TIMEOUT_MS || 8000);
    const shouldTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const controller = shouldTimeout ? new AbortController() : null;
    const timeoutId = shouldTimeout ? setTimeout(() => controller?.abort(), Math.floor(timeoutMs)) : null;
    try {
        const response = await callClassifierEndpoint(payload, controller?.signal);
        const prediction = pickBestPrediction(response);
        if (!prediction) {
            return {
                type: "UNKNOWN",
                confidence: 0.2,
                reasons: ["Réponse du classifieur invalide"],
            };
        }
        const normalized = normalizeLabel(prediction.label, labelMap);
        if (!normalized) {
            return {
                type: "UNKNOWN",
                confidence: clampScore(prediction.score),
                reasons: ["Label ML non reconnu"],
            };
        }
        return {
            type: normalized,
            confidence: clampScore(prediction.score),
            reasons: [`Classification ML (${provider}:${modelName})`],
        };
    }
    catch (_err) {
        return {
            type: "UNKNOWN",
            confidence: 0.2,
            reasons: ["Erreur d'appel au modèle de classification"],
        };
    }
    finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}
exports.__test__ = {
    normalizeLabel,
    pickBestPrediction,
    resolveLabels,
};
