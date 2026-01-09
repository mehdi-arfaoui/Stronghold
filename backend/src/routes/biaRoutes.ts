import { Router } from "express";
import prisma from "../prismaClient";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import {
  buildValidationError,
  parseOptionalString,
  parseRequiredNumber,
  parseRequiredString,
  parseStringArray,
  type ValidationIssue,
} from "../validation/common";
import {
  buildBiaSummary,
  scoreCriticality,
  scoreImpact,
  scoreTimeSensitivity,
} from "../services/biaSummary";

const router = Router();

const IMPACT_LEVEL_MIN = 1;
const IMPACT_LEVEL_MAX = 5;

const ensureImpactLevel = (
  value: unknown,
  field: string,
  issues: ValidationIssue[]
) => {
  const parsed = parseRequiredNumber(value, field, issues, {
    min: IMPACT_LEVEL_MIN,
  });
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed > IMPACT_LEVEL_MAX) {
    issues.push({
      field,
      message: `doit être inférieur ou égal à ${IMPACT_LEVEL_MAX}`,
    });
    return undefined;
  }
  return parsed;
};

export const __test__ = {
  scoreImpact,
  scoreTimeSensitivity,
  scoreCriticality,
};

router.get("/summary", requireRole("READER"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const summary = await buildBiaSummary(prisma, tenantId);
    return res.json(summary);
  } catch (error) {
    console.error("Error fetching BIA summary", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/processes", requireRole("OPERATOR"), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const payload = req.body || {};
    const issues: ValidationIssue[] = [];
    const name = parseRequiredString(payload.name, "name", issues, { minLength: 2 });
    const description = parseOptionalString(payload.description, "description", issues, {
      allowNull: true,
    });
    const owners = parseOptionalString(payload.owners, "owners", issues, { allowNull: true });
    const interdependencies = parseOptionalString(
      payload.interdependencies,
      "interdependencies",
      issues,
      { allowNull: true }
    );

    const financialImpactLevel = ensureImpactLevel(
      payload.financialImpactLevel,
      "financialImpactLevel",
      issues
    );
    const regulatoryImpactLevel = ensureImpactLevel(
      payload.regulatoryImpactLevel,
      "regulatoryImpactLevel",
      issues
    );
    const rtoHours = parseRequiredNumber(payload.rtoHours, "rtoHours", issues, { min: 0 });
    const rpoMinutes = parseRequiredNumber(payload.rpoMinutes, "rpoMinutes", issues, { min: 0 });
    const mtpdHours = parseRequiredNumber(payload.mtpdHours, "mtpdHours", issues, { min: 0 });

    const serviceIds = parseStringArray(payload.serviceIds, "serviceIds", issues) ?? [];

    if (issues.length > 0) {
      return res.status(400).json(buildValidationError(issues));
    }

    const services = await prisma.service.findMany({
      where: { tenantId, id: { in: serviceIds } },
      select: { id: true },
    });
    if (services.length !== serviceIds.length) {
      return res
        .status(400)
        .json({ error: "Certaines références de services sont invalides" });
    }

    const impactScore = scoreImpact(financialImpactLevel!, regulatoryImpactLevel!);
    const timeScore = scoreTimeSensitivity(rtoHours!, rpoMinutes!, mtpdHours!);
    const criticalityScore = scoreCriticality(impactScore, timeScore);

    const process = await prisma.businessProcess.create({
      data: {
        tenantId,
        name: name!,
        description,
        owners,
        financialImpactLevel: financialImpactLevel!,
        regulatoryImpactLevel: regulatoryImpactLevel!,
        interdependencies,
        rtoHours: rtoHours!,
        rpoMinutes: rpoMinutes!,
        mtpdHours: mtpdHours!,
        impactScore,
        criticalityScore,
        services: {
          create: services.map((service) => ({
            tenantId,
            serviceId: service.id,
          })),
        },
      },
      include: {
        services: {
          include: { service: true },
        },
      },
    });

    return res.status(201).json(process);
  } catch (error) {
    console.error("Error creating business process", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/processes", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const processes = await prisma.businessProcess.findMany({
      where: { tenantId },
      include: {
        services: {
          include: { service: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.json(processes);
  } catch (error) {
    console.error("Error fetching business processes", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
