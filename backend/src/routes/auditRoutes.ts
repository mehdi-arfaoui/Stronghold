import { Router } from "express";
import prisma from "../prismaClient";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";

const router = Router();

const DEFAULT_LIMIT = 200;

function parseDateFilter(dateValue: string) {
  const isoCandidate = `${dateValue}T00:00:00.000Z`;
  const start = new Date(isoCandidate);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return { start, end };
}

router.get("/", requireRole("ADMIN"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { date, statusCode, path } = req.query;

    const filters: any = { tenantId };

    if (typeof statusCode === "string" && statusCode.trim()) {
      const parsed = Number.parseInt(statusCode, 10);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "statusCode invalide" });
      }
      filters.statusCode = parsed;
    }

    if (typeof path === "string" && path.trim()) {
      filters.path = { contains: path.trim(), mode: "insensitive" };
    }

    if (typeof date === "string" && date.trim()) {
      const range = parseDateFilter(date.trim());
      if (!range) {
        return res.status(400).json({ error: "date invalide (format attendu YYYY-MM-DD)" });
      }
      filters.createdAt = {
        gte: range.start,
        lt: range.end,
      };
    }

    const logs = await prisma.auditLog.findMany({
      where: filters,
      orderBy: { createdAt: "desc" },
      take: DEFAULT_LIMIT,
      select: {
        id: true,
        apiKeyId: true,
        path: true,
        method: true,
        statusCode: true,
        success: true,
        errorCode: true,
        latencyMs: true,
        clientIp: true,
        userAgent: true,
        correlationId: true,
        createdAt: true,
      },
    });

    return res.json({
      limit: DEFAULT_LIMIT,
      count: logs.length,
      logs,
    });
  } catch (error) {
    console.error("Error in GET /audit-logs:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
