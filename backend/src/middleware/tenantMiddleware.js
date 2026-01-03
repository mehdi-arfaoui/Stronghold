"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantMiddleware = void 0;
exports.requireRole = requireRole;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware = async (req, res, next) => {
    try {
        // laisser passer /health sans auth
        if (req.path === "/health") {
            return next();
        }
        const correlationId = req.header("x-correlation-id") || crypto_1.default.randomUUID();
        req.correlationId = correlationId;
        res.setHeader("x-correlation-id", correlationId);
        const startedAt = Date.now();
        const apiKey = req.header("x-api-key");
        if (!apiKey) {
            console.warn("tenantMiddleware: missing x-api-key header");
            return res.status(401).json({ error: "Missing x-api-key header" });
        }
        const apiKeyHash = crypto_1.default.createHash("sha256").update(apiKey).digest("hex");
        const now = new Date();
        const existingApiKey = await prismaClient_1.default.apiKey.findFirst({
            where: { keyHash: apiKeyHash, revokedAt: null },
        });
        if (existingApiKey?.expiresAt && existingApiKey.expiresAt <= now) {
            req.tenantId = existingApiKey.tenantId;
            return res.status(403).json({ error: "API key expired" });
        }
        const resolvedTenant = existingApiKey && (!existingApiKey.expiresAt || existingApiKey.expiresAt > now)
            ? await prismaClient_1.default.tenant.findUnique({ where: { id: existingApiKey.tenantId } })
            : await prismaClient_1.default.tenant.findUnique({ where: { apiKey } });
        if (!resolvedTenant) {
            console.warn("tenantMiddleware: invalid API key provided");
            return res.status(403).json({ error: "Invalid API key" });
        }
        const apiRole = existingApiKey?.role ?? "ADMIN";
        req.tenantId = resolvedTenant.id;
        req.apiKeyId = existingApiKey?.id;
        req.apiRole = apiRole;
        res.on("finish", async () => {
            try {
                if (!req.tenantId)
                    return;
                await prismaClient_1.default.auditLog.create({
                    data: {
                        tenantId: req.tenantId,
                        apiKeyId: req.apiKeyId ?? null,
                        path: req.originalUrl || req.path,
                        method: req.method,
                        statusCode: res.statusCode,
                        success: res.statusCode < 400,
                        errorCode: res.statusCode >= 400 ? String(res.statusCode) : null,
                        latencyMs: Date.now() - startedAt,
                        clientIp: req.ip || req.headers["x-forwarded-for"]?.toString() || null,
                        userAgent: req.headers["user-agent"] || null,
                        correlationId,
                    },
                });
                if (existingApiKey) {
                    await prismaClient_1.default.apiKey.updateMany({
                        where: { id: existingApiKey.id },
                        data: { lastUsedAt: new Date() },
                    });
                }
            }
            catch (err) {
                console.warn("Failed to persist audit log", { message: err?.message });
            }
        });
        next();
    }
    catch (error) {
        console.error("Error in tenantMiddleware:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
exports.tenantMiddleware = tenantMiddleware;
const ROLE_RANK = {
    READER: 1,
    OPERATOR: 2,
    ADMIN: 3,
};
function hasSufficientRole(current, required) {
    if (!current)
        return false;
    return ROLE_RANK[current] >= ROLE_RANK[required];
}
function requireRole(required) {
    return (req, res, next) => {
        const currentRole = req.apiRole;
        if (!hasSufficientRole(currentRole, required)) {
            return res.status(403).json({ error: `Forbidden: ${required} role required` });
        }
        return next();
    };
}
//# sourceMappingURL=tenantMiddleware.js.map