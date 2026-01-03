"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const prismaClient_1 = __importDefault(require("../prismaClient"));
const tenantMiddleware_1 = require("../middleware/tenantMiddleware");
const router = (0, express_1.Router)();
function generateApiKey() {
    const raw = `sk_${crypto_1.default.randomBytes(32).toString("hex")}`;
    const hash = crypto_1.default.createHash("sha256").update(raw).digest("hex");
    return { raw, hash };
}
function parseRole(input) {
    const normalized = String(input || "").toUpperCase();
    if (normalized === "ADMIN")
        return "ADMIN";
    if (normalized === "READER")
        return "READER";
    return "OPERATOR";
}
function computeExpiry(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0)
        return null;
    const expires = new Date();
    expires.setDate(expires.getDate() + Math.floor(n));
    return expires;
}
router.get("/api-keys", (0, tenantMiddleware_1.requireRole)("ADMIN"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const keys = await prismaClient_1.default.apiKey.findMany({
            where: { tenantId },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                label: true,
                role: true,
                expiresAt: true,
                revokedAt: true,
                lastUsedAt: true,
                rotatedFromId: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return res.json(keys);
    }
    catch (error) {
        console.error("Error in GET /auth/api-keys:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/api-keys", (0, tenantMiddleware_1.requireRole)("ADMIN"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { label, role, expiresInDays } = req.body || {};
        const { raw, hash } = generateApiKey();
        const expiresAt = computeExpiry(expiresInDays);
        const parsedRole = parseRole(role);
        const created = await prismaClient_1.default.apiKey.create({
            data: {
                tenantId,
                label: label ? String(label).trim() : null,
                keyHash: hash,
                role: parsedRole,
                expiresAt,
            },
        });
        return res.status(201).json({
            id: created.id,
            apiKey: raw,
            role: created.role,
            expiresAt: created.expiresAt,
            label: created.label,
        });
    }
    catch (error) {
        console.error("Error in POST /auth/api-keys:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
router.post("/api-keys/rotate", (0, tenantMiddleware_1.requireRole)("ADMIN"), async (req, res) => {
    try {
        const tenantId = req.tenantId;
        if (!tenantId) {
            return res.status(500).json({ error: "Tenant not resolved" });
        }
        const { label, expiresInDays, role } = req.body || {};
        const { raw, hash } = generateApiKey();
        const expiresAt = computeExpiry(expiresInDays);
        const parsedRole = parseRole(role || req.apiRole || "OPERATOR");
        const created = await prismaClient_1.default.apiKey.create({
            data: {
                tenantId,
                label: label ? String(label).trim() : null,
                keyHash: hash,
                role: parsedRole,
                expiresAt,
                rotatedFromId: req.apiKeyId ?? null,
            },
        });
        if (req.apiKeyId) {
            await prismaClient_1.default.apiKey.updateMany({
                where: { id: req.apiKeyId, tenantId },
                data: { revokedAt: new Date() },
            });
        }
        return res.status(201).json({
            id: created.id,
            apiKey: raw,
            role: created.role,
            expiresAt: created.expiresAt,
            rotatedFromId: req.apiKeyId ?? null,
        });
    }
    catch (error) {
        console.error("Error in POST /auth/api-keys/rotate:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});
exports.default = router;
//# sourceMappingURL=authRoutes.js.map