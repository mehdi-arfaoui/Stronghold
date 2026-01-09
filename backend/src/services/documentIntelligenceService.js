"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDependencyExpression = parseDependencyExpression;
exports.inferInfraComponent = inferInfraComponent;
exports.deriveMetadataMappings = deriveMetadataMappings;
exports.classifyDocumentType = classifyDocumentType;
exports.extractDocumentMetadata = extractDocumentMetadata;
exports.extractStructuredMetadata = extractStructuredMetadata;
exports.buildChunks = buildChunks;
exports.buildChromaCollectionName = buildChromaCollectionName;
exports.pushChunksToChroma = pushChunksToChroma;
exports.serializeMetadata = serializeMetadata;
const crypto = __importStar(require("crypto"));
function scoreKeywords(content, keywords) {
    return keywords.reduce((acc, regex) => (regex.test(content) ? acc + 1 : acc), 0);
}
function normalizeEntityLabel(value) {
    return (value || "").replace(/\s+/g, " ").trim();
}
function parseDependencyExpression(raw) {
    if (!raw || raw.trim().length === 0)
        return null;
    const cleaned = normalizeEntityLabel(raw);
    const arrowMatch = cleaned.split(/(?:->|=>|→|>)/);
    if (arrowMatch.length >= 2) {
        const from = normalizeEntityLabel(arrowMatch[0] || "");
        const to = normalizeEntityLabel(arrowMatch.slice(1).join("->"));
        if (to) {
            return from ? { from, to } : { to };
        }
    }
    const dependsMatch = cleaned.match(/(.+?)\s+(?:d[ée]pend(?:s)? de|depends on)\s+(.+)/i);
    if (dependsMatch?.[2]) {
        const from = normalizeEntityLabel(dependsMatch[1] || "");
        const to = normalizeEntityLabel(dependsMatch[2]);
        return from ? { from, to } : { to };
    }
    if (cleaned.includes(":")) {
        const [lhs, rhs] = cleaned.split(/:/, 2);
        const to = normalizeEntityLabel(rhs || "");
        if (to) {
            const from = normalizeEntityLabel(lhs || "");
            return from ? { from, to } : { to };
        }
    }
    return { to: cleaned };
}
const INFRA_HINTS = [
    { regex: /\b(postgres(?:ql)?|mysql|mariadb|oracle|sql\s*server)\b/i, type: "DATABASE" },
    { regex: /\b(redis|cache|memcached)\b/i, type: "CACHE" },
    { regex: /\b(kafka|rabbitmq|sqs|pubsub|activemq|mq)\b/i, type: "MESSAGE_BUS" },
    { regex: /\b(kubernetes|k8s|eks|aks|gke|openshift)\b/i, type: "CONTAINER_ORCHESTRATION" },
    { regex: /\b(nginx|haproxy|load balancer|reverse proxy|ingress)\b/i, type: "NETWORK" },
    { regex: /\b(vpn|firewall|waf|ids|ips)\b/i, type: "SECURITY" },
    { regex: /\b(storage|bucket|s3|blob|gcs|nas|san)\b/i, type: "STORAGE" },
    { regex: /\b(aws|ec2|lambda|rds|aurora)\b/i, type: "CLOUD", provider: "AWS" },
    { regex: /\b(azure|vmss|aks|cosmos|blob)\b/i, type: "CLOUD", provider: "AZURE" },
    { regex: /\b(gcp|gce|gke|cloud run|spanner)\b/i, type: "CLOUD", provider: "GCP" },
    { regex: /\b(vm|server|instance|bare[- ]metal)\b/i, type: "COMPUTE" },
];
function inferInfraComponent(label) {
    const normalized = normalizeEntityLabel(label);
    if (!normalized)
        return null;
    for (const hint of INFRA_HINTS) {
        if (hint.regex.test(normalized)) {
            const result = {
                name: normalized,
                type: hint.type,
            };
            if (hint.provider) {
                result.provider = hint.provider;
            }
            return result;
        }
    }
    return null;
}
function deriveMetadataMappings(metadata) {
    const serviceMap = new Map();
    const infraMap = new Map();
    const dependencies = [];
    (metadata.services || []).forEach((svc) => {
        const normalized = normalizeEntityLabel(svc);
        if (normalized) {
            serviceMap.set(normalized.toLowerCase(), normalized);
        }
    });
    for (const rawDep of metadata.dependencies || []) {
        const parsed = parseDependencyExpression(rawDep);
        if (!parsed?.to)
            continue;
        const targetInfra = inferInfraComponent(parsed.to);
        const normalizedTo = normalizeEntityLabel(parsed.to);
        const normalizedFrom = parsed.from ? normalizeEntityLabel(parsed.from) : null;
        if (normalizedFrom && normalizedFrom.length > 0) {
            serviceMap.set(normalizedFrom.toLowerCase(), normalizedFrom);
        }
        if (!targetInfra && normalizedTo) {
            serviceMap.set(normalizedTo.toLowerCase(), normalizedTo);
        }
        if (targetInfra) {
            infraMap.set(targetInfra.name.toLowerCase(), targetInfra);
        }
        const dependencyBase = {
            to: targetInfra ? targetInfra.name : normalizedTo,
            targetIsInfra: Boolean(targetInfra),
        };
        if (normalizedFrom) {
            dependencyBase.from = normalizedFrom;
        }
        dependencies.push(dependencyBase);
    }
    return {
        services: Array.from(serviceMap.values()),
        dependencies,
        infra: Array.from(infraMap.values()),
    };
}
function classifyDocumentType(text, fileName, providedDocType) {
    const normalizedText = (text || "").toLowerCase();
    const name = (fileName || "").toLowerCase();
    const declared = (providedDocType || "").toUpperCase();
    if (declared && declared.length >= 3) {
        return { type: declared, confidence: 0.9, reasons: ["Type fourni par l'utilisateur"] };
    }
    const candidates = [];
    const archiScore = scoreKeywords(normalizedText, [/diagram/, /architecture/, /topologie/, /vpc/, /subnet/]) +
        scoreKeywords(name, [/archi/, /diagram/]);
    candidates.push({ type: "ARCHI", score: archiScore, reasons: ["Présence de termes d'architecture"] });
    const backupScore = scoreKeywords(normalizedText, [/backup/, /sauvegarde/, /r\s*to/, /r\s*po/, /restauration/]) +
        scoreKeywords(name, [/backup/, /sauvegarde/]);
    candidates.push({ type: "BACKUP_POLICY", score: backupScore, reasons: ["Mentions de sauvegarde/PRA"] });
    const slaScore = scoreKeywords(normalizedText, [/sla/, /service level/, /uptime/, /availability/]);
    candidates.push({ type: "SLA", score: slaScore, reasons: ["Mentions SLA/availability"] });
    const runbookScore = scoreKeywords(normalizedText, [/runbook/, /procédure/, /plan de reprise/, /étape/]);
    candidates.push({ type: "RUNBOOK", score: runbookScore, reasons: ["Structure en procédures ou runbook"] });
    const cmdbScore = scoreKeywords(normalizedText, [/cmdb/, /configuration item/, /inventaire/, /asset/]);
    candidates.push({ type: "CMDB", score: cmdbScore, reasons: ["Inventaire ou CMDB"] });
    const contractScore = scoreKeywords(normalizedText, [/contrat/, /agreement/, /annexe/, /tiers/]);
    candidates.push({ type: "CONTRACT", score: contractScore, reasons: ["Termes contractuels"] });
    const riskScore = scoreKeywords(normalizedText, [/risque/, /risk/, /impact/, /menace/]);
    candidates.push({ type: "RISK", score: riskScore, reasons: ["Analyse de risques"] });
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (!best || best.score === 0) {
        return { type: "UNKNOWN", confidence: 0.25, reasons: ["Aucune signature forte détectée"] };
    }
    const confidence = Math.min(0.95, Math.max(0.35, best.score / 4));
    return { type: best.type, confidence, reasons: best.reasons };
}
function extractNumericValue(text, regex, multiplier) {
    const match = regex.exec(text);
    if (!match)
        return undefined;
    const raw = match[1];
    if (!raw)
        return undefined;
    const value = Number(raw.replace(/,/g, "."));
    if (Number.isNaN(value))
        return undefined;
    return Math.round(value * multiplier);
}
function extractDocumentMetadata(text) {
    const normalized = text || "";
    const services = Array.from(new Set(Array.from(normalized.matchAll(/(?:service|application)\s*[:\-]\s*([A-Za-z0-9 _\-]{3,80})/gi))
        .map((m) => m[1]?.trim())
        .filter((s) => Boolean(s && s.length > 0))));
    const slaMatches = Array.from(normalized.matchAll(/sla\s*[:=]\s*([^\n\r]{1,120})/gi))
        .map((m) => m[1])
        .filter((v) => typeof v === "string")
        .map((s) => s.trim());
    const backupMentions = Array.from(normalized.matchAll(/(full|incr[ée]ment(al)?|differential|diff[ée]rentielle)/gi))
        .map((m) => m[1])
        .filter((v) => typeof v === "string")
        .map((v) => v.toLowerCase());
    const dependencies = Array.from(normalized.matchAll(/d[ée]pend[ea]nce\s*[:\-]\s*([^\n\r]{1,120})/gi))
        .map((m) => m[1])
        .filter((v) => typeof v === "string")
        .map((s) => s.trim());
    const meta = {
        services,
        slas: slaMatches,
    };
    const rtoHours = extractNumericValue(normalized.toLowerCase(), /rto\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)\s*h/i, 1);
    const rpoMinutes = extractNumericValue(normalized.toLowerCase(), /rpo\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)/i, 1);
    const mtpdHours = extractNumericValue(normalized.toLowerCase(), /mtpd\s*[:=]\s*([0-9]+(?:[\.,][0-9]+)?)/i, 1);
    if (rtoHours != null)
        meta.rtoHours = rtoHours;
    if (rpoMinutes != null)
        meta.rpoMinutes = rpoMinutes;
    if (mtpdHours != null)
        meta.mtpdHours = mtpdHours;
    if (backupMentions.length > 0)
        meta.backupMentions = backupMentions;
    if (dependencies.length > 0)
        meta.dependencies = dependencies;
    return meta;
}
function extractStructuredMetadata(structuredPayload) {
    const metadata = { services: [], slas: [] };
    if (!structuredPayload || typeof structuredPayload !== "object") {
        return metadata;
    }
    const asAny = structuredPayload;
    if (Array.isArray(asAny.services)) {
        metadata.services = asAny.services
            .map((s) => (typeof s === "string" ? s : s?.name))
            .filter((v) => typeof v === "string")
            .map((s) => s.trim());
    }
    if (Array.isArray(asAny.sla)) {
        metadata.slas = asAny.sla
            .map((v) => (typeof v === "string" ? v : v?.details))
            .filter((v) => typeof v === "string")
            .map((s) => s.trim());
    }
    if (asAny.rtoHours)
        metadata.rtoHours = Number(asAny.rtoHours);
    if (asAny.rpoMinutes)
        metadata.rpoMinutes = Number(asAny.rpoMinutes);
    if (asAny.mtpdHours)
        metadata.mtpdHours = Number(asAny.mtpdHours);
    metadata.structuredSummary = JSON.stringify(asAny, null, 2).slice(0, 4000);
    return metadata;
}
function buildChunks(text, baseMetadata, maxLength = 900, overlap = 80) {
    const sanitized = (text || "").replace(/\r\n/g, "\n");
    const paragraphs = sanitized.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0);
    const chunks = [];
    const seen = new Set();
    const sentences = paragraphs.flatMap((paragraph) => splitIntoSentences(paragraph));
    const sentenceChunks = buildSentenceChunks(sentences, maxLength);
    for (let index = 0; index < sentenceChunks.length; index += 1) {
        const baseText = sentenceChunks[index];
        const overlapText = overlap > 0 && index > 0
            ? sentenceChunks[index - 1].slice(Math.max(0, sentenceChunks[index - 1].length - overlap))
            : "";
        const mergedText = overlapText ? `${overlapText} ${baseText}`.trim() : baseText;
        const chunkText = mergedText.slice(0, maxLength).trim();
        if (!chunkText)
            continue;
        const hash = crypto.createHash("sha256").update(chunkText).digest("hex");
        if (seen.has(hash))
            continue;
        seen.add(hash);
        const id = crypto.randomUUID();
        chunks.push({
            id,
            content: chunkText,
            hash,
            metadata: { ...baseMetadata, length: chunkText.length },
        });
    }
    return chunks;
}
function splitIntoSentences(text) {
    return text
        .split(/(?<=[.!?…])\s+|\n+/)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 0);
}
function infoDensity(text) {
    const tokens = text
        .replace(/[^a-zA-Z0-9À-ÿ\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0)
        return 0;
    const informative = tokens.filter((token) => token.length >= 5 || /\d/.test(token)).length;
    return informative / tokens.length;
}
function buildSentenceChunks(sentences, maxLength) {
    const chunks = [];
    let current = "";
    const flush = () => {
        if (current.trim().length > 0) {
            chunks.push(current.trim());
        }
        current = "";
    };
    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed)
            continue;
        const candidate = current ? `${current} ${trimmed}` : trimmed;
        if (candidate.length <= maxLength) {
            current = candidate;
            continue;
        }
        if (current && infoDensity(current) < 0.18 && current.length < maxLength * 0.6) {
            current = candidate.slice(0, maxLength);
            continue;
        }
        flush();
        current = trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
    }
    flush();
    return chunks;
}
function sanitizeCollectionPart(value) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    return normalized.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}
function buildChromaCollectionName(baseCollection, tenantId) {
    const base = sanitizeCollectionPart(baseCollection || "pra-documents") || "pra-documents";
    const tenantPart = sanitizeCollectionPart(tenantId) || "tenant";
    return `${base}-${tenantPart}`.slice(0, 60);
}
async function pushChunksToChroma(chunks, tenantId, documentId, retention) {
    const chromaUrl = process.env.CHROMADB_URL;
    const collection = buildChromaCollectionName(process.env.CHROMADB_COLLECTION || "pra-documents", tenantId);
    if (!chromaUrl) {
        return { submitted: 0, skippedReason: "CHROMADB_URL not configured" };
    }
    if (chunks.length === 0) {
        return { submitted: 0, skippedReason: "No chunks to index" };
    }
    const payload = {
        ids: chunks.map((c) => c.id),
        documents: chunks.map((c) => c.content),
        metadatas: chunks.map((c) => ({
            ...c.metadata,
            tenantId,
            documentId,
            retentionUntil: retention?.document ? retention.document.toISOString() : undefined,
            embeddingRetentionUntil: retention?.embedding
                ? retention.embedding.toISOString()
                : undefined,
        })),
    };
    const headers = { "Content-Type": "application/json" };
    if (process.env.CHROMADB_API_TOKEN) {
        headers.Authorization = `Bearer ${process.env.CHROMADB_API_TOKEN}`;
    }
    const response = await fetch(`${chromaUrl}/api/v1/collections/${collection}/add`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText);
        throw new Error(`Failed to push chunks to ChromaDB: ${response.status} ${errText}`);
    }
    return { submitted: chunks.length };
}
function serializeMetadata(metadata) {
    return JSON.stringify(metadata);
}
//# sourceMappingURL=documentIntelligenceService.js.map
