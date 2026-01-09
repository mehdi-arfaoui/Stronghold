import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import {
  buildValidationError,
  parseOptionalEnum,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredNumber,
  parseRequiredString,
} from "../validation/common.js";
import { buildRiskSummary, riskLevel, riskScore } from "../services/riskSummary.js";

const router = Router();

const THREAT_TYPES = [
  "cyber",
  "physical",
  "supplier",
  "human",
  "operational",
  "environmental",
  "compliance",
];

const STATUS_VALUES = ["open", "mitigating", "accepted", "closed"];

export const __test__ = {
  riskScore,
  riskLevel,
};

function validateScale(value: number | null | undefined, field: string, issues: any[]) {
  if (value == null) return;
  if (value < 1 || value > 5) {
    issues.push({ field, message: "doit être compris entre 1 et 5" });
  }
}

function parseDueDate(value: unknown, field: string, issues: any[]) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    issues.push({ field, message: "doit être une date au format ISO" });
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    issues.push({ field, message: "date invalide" });
    return null;
  }
  return parsed;
}

router.get("/", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { serviceId, processName, threatType, status } = req.query;

    const issues: { field: string; message: string }[] = [];
    const limit = parseOptionalNumber(req.query.limit, "limit", issues, { min: 1 });
    const offset = parseOptionalNumber(req.query.offset, "offset", issues, { min: 0 });
    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const shouldPaginate = limit !== undefined || offset !== undefined;
    const take = limit ?? 25;
    const skip = offset ?? 0;

    const where = {
      tenantId,
      ...(serviceId ? { serviceId: String(serviceId) } : {}),
      ...(processName ? { processName: String(processName) } : {}),
      ...(threatType ? { threatType: String(threatType) } : {}),
      ...(status ? { status: String(status) } : {}),
    };

    const [risks, total] = await Promise.all([
      prisma.risk.findMany({
        where,
        include: {
          service: true,
          mitigations: true,
        },
        orderBy: [{ createdAt: "desc" }],
        ...(shouldPaginate ? { take, skip } : {}),
      }),
      shouldPaginate ? prisma.risk.count({ where }) : Promise.resolve(0),
    ]);

    const enriched = risks.map((risk) => {
      const score = riskScore(risk.probability, risk.impact);
      return {
        ...risk,
        score,
        level: riskLevel(score),
      };
    });

    if (shouldPaginate) {
      return res.json({
        items: enriched,
        total,
        limit: take,
        offset: skip,
      });
    }

    return res.json(enriched);
  } catch (error) {
    console.error("Error in GET /risks:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/summary", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const summary = await buildRiskSummary(prisma, tenantId);
    return res.json(summary);
  } catch (error) {
    console.error("Error in GET /risks/summary:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/matrix", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const risks = await prisma.risk.findMany({
      where: { tenantId },
      include: { service: true },
    });

    const probabilityScale = [1, 2, 3, 4, 5];
    const impactScale = [1, 2, 3, 4, 5];

    const cellMap = new Map<string, any>();

    for (const probability of probabilityScale) {
      for (const impact of impactScale) {
        const score = riskScore(probability, impact);
        cellMap.set(`${probability}:${impact}`, {
          probability,
          impact,
          score,
          level: riskLevel(score),
          count: 0,
          risks: [] as any[],
        });
      }
    }

    for (const risk of risks) {
      const score = riskScore(risk.probability, risk.impact);
      const cellKey = `${risk.probability}:${risk.impact}`;
      const cell = cellMap.get(cellKey);
      if (!cell) continue;
      cell.count += 1;
      cell.risks.push({
        id: risk.id,
        title: risk.title,
        score,
        level: riskLevel(score),
        serviceName: risk.service?.name || null,
        processName: risk.processName || null,
      });
    }

    return res.json({
      meta: { tenantId },
      scale: { probability: probabilityScale, impact: impactScale },
      cells: Array.from(cellMap.values()),
      totalRisks: risks.length,
    });
  } catch (error) {
    console.error("Error in GET /risks/matrix:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];

    const title = parseRequiredString(payload.title, "title", issues, { minLength: 3 });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const threatType = parseOptionalEnum(payload.threatType, "threatType", issues, THREAT_TYPES);
    const probability = parseRequiredNumber(payload.probability, "probability", issues, { min: 1 });
    const impact = parseRequiredNumber(payload.impact, "impact", issues, { min: 1 });
    const status = parseOptionalEnum(payload.status, "status", issues, STATUS_VALUES, {
      allowNull: true,
    });
    const owner = parseOptionalString(payload.owner, "owner", issues, { allowNull: true });
    const processName = parseOptionalString(payload.processName, "processName", issues, {
      allowNull: true,
    });
    const serviceId = parseOptionalString(payload.serviceId, "serviceId", issues, {
      allowNull: true,
    });

    validateScale(probability, "probability", issues);
    validateScale(impact, "impact", issues);

    const mitigationsPayload = payload.mitigations;
    const mitigationCreates: any[] = [];

    if (mitigationsPayload !== undefined) {
      if (!Array.isArray(mitigationsPayload)) {
        issues.push({ field: "mitigations", message: "doit être un tableau" });
      } else {
        mitigationsPayload.forEach((item: any, index: number) => {
          const descriptionField = `mitigations[${index}].description`;
          const mitigationDescription = parseRequiredString(item?.description, descriptionField, issues, {
            minLength: 3,
          });
          const mitigationOwner = parseOptionalString(
            item?.owner,
            `mitigations[${index}].owner`,
            issues,
            { allowNull: true }
          );
          const mitigationStatus = parseOptionalString(
            item?.status,
            `mitigations[${index}].status`,
            issues,
            { allowNull: true }
          );
          const mitigationDueDate = parseDueDate(
            item?.dueDate,
            `mitigations[${index}].dueDate`,
            issues
          );

          if (mitigationDescription) {
            mitigationCreates.push({
              description: mitigationDescription,
              owner: mitigationOwner,
              status: mitigationStatus,
              dueDate: mitigationDueDate,
              tenantId,
            });
          }
        });
      }
    }

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    if (serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: serviceId, tenantId },
      });
      if (!service) {
        return res.status(404).json({ error: "Service introuvable pour ce tenant" });
      }
    }

    if (!threatType) {
      return res.status(400).json(buildValidationError([{ field: "threatType", message: "champ requis" }]));
    }

    const risk = await prisma.risk.create({
      data: {
        tenantId,
        title,
        description: description ?? null,
        threatType,
        probability: probability ?? 1,
        impact: impact ?? 1,
        status,
        owner,
        processName,
        serviceId: serviceId || null,
        mitigations: mitigationCreates.length > 0 ? { create: mitigationCreates } : undefined,
      },
      include: { mitigations: true, service: true },
    });

    const score = riskScore(risk.probability, risk.impact);

    return res.status(201).json({
      ...risk,
      score,
      level: riskLevel(score),
    });
  } catch (error) {
    console.error("Error in POST /risks:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/:id", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const riskId = req.params.id;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];

    const title = parseOptionalString(payload.title, "title", issues, { minLength: 3 });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const threatType = parseOptionalEnum(payload.threatType, "threatType", issues, THREAT_TYPES);
    const probability = parseOptionalNumber(payload.probability, "probability", issues, { min: 1 });
    const impact = parseOptionalNumber(payload.impact, "impact", issues, { min: 1 });
    const status = parseOptionalEnum(payload.status, "status", issues, STATUS_VALUES, {
      allowNull: true,
    });
    const owner = parseOptionalString(payload.owner, "owner", issues, { allowNull: true });
    const processName = parseOptionalString(payload.processName, "processName", issues, {
      allowNull: true,
    });
    const serviceId = parseOptionalString(payload.serviceId, "serviceId", issues, {
      allowNull: true,
    });

    validateScale(probability ?? undefined, "probability", issues);
    validateScale(impact ?? undefined, "impact", issues);

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const risk = await prisma.risk.findFirst({
      where: { id: riskId, tenantId },
    });

    if (!risk) {
      return res.status(404).json({ error: "Risque introuvable pour ce tenant" });
    }

    if (serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: serviceId, tenantId },
      });
      if (!service) {
        return res.status(404).json({ error: "Service introuvable pour ce tenant" });
      }
    }

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (threatType !== undefined) data.threatType = threatType;
    if (probability !== undefined) data.probability = probability;
    if (impact !== undefined) data.impact = impact;
    if (status !== undefined) data.status = status;
    if (owner !== undefined) data.owner = owner;
    if (processName !== undefined) data.processName = processName;
    if (serviceId !== undefined) data.serviceId = serviceId;

    const updated = await prisma.risk.update({
      where: { id: riskId },
      data,
      include: { mitigations: true, service: true },
    });

    const score = riskScore(updated.probability, updated.impact);

    return res.json({
      ...updated,
      score,
      level: riskLevel(score),
    });
  } catch (error) {
    console.error("Error in PUT /risks/:id:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:id/mitigations", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const riskId = req.params.id;
    const payload = req.body || {};
    const issues: { field: string; message: string }[] = [];

    const description = parseRequiredString(payload.description, "description", issues, {
      minLength: 3,
    });
    const owner = parseOptionalString(payload.owner, "owner", issues, { allowNull: true });
    const status = parseOptionalString(payload.status, "status", issues, { allowNull: true });
    const dueDate = parseDueDate(payload.dueDate, "dueDate", issues);

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const risk = await prisma.risk.findFirst({
      where: { id: riskId, tenantId },
    });

    if (!risk) {
      return res.status(404).json({ error: "Risque introuvable pour ce tenant" });
    }

    const mitigation = await prisma.riskMitigation.create({
      data: {
        tenantId,
        riskId,
        description,
        owner,
        status,
        dueDate,
      },
    });

    return res.status(201).json(mitigation);
  } catch (error) {
    console.error("Error in POST /risks/:id/mitigations:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
