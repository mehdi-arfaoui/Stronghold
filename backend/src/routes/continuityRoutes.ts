import { appLogger } from "../utils/logger.js";
import { Router } from "express";
import prisma from "../prismaClient.js";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";

const router = Router();

const BACKUP_TYPES = [
  "full",
  "differential",
  "incremental",
  "continuous",
  "snapshot",
] as const;

router.post(
  "/backup-strategies",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const {
      serviceId,
      type,
      frequencyMinutes,
      retentionDays,
      storageLocation,
      encryptionLevel,
      compression,
      immutability,
      rtoImpactHours,
      rpoImpactMinutes,
      notes,
    } = req.body || {};

    if (!type || !BACKUP_TYPES.includes(String(type).toLowerCase() as any)) {
      return res.status(400).json({
        error: `type doit être parmi ${BACKUP_TYPES.join(", ")}`,
      });
    }
    if (!frequencyMinutes || !retentionDays) {
      return res
        .status(400)
        .json({ error: "frequencyMinutes et retentionDays sont requis" });
    }

    if (serviceId) {
      const service = await prisma.service.findFirst({ where: { id: serviceId, tenantId } });
      if (!service) {
        return res.status(404).json({ error: "Service introuvable pour ce tenant" });
      }
    }

    const strategy = await prisma.backupStrategy.create({
      data: {
        tenantId,
        serviceId: serviceId || null,
        type: String(type).toLowerCase(),
        frequencyMinutes: Number(frequencyMinutes),
        retentionDays: Number(retentionDays),
        storageLocation: storageLocation ? String(storageLocation) : null,
        encryptionLevel: encryptionLevel ? String(encryptionLevel) : null,
        compression: Boolean(compression),
        immutability: Boolean(immutability),
        rtoImpactHours: rtoImpactHours != null ? Number(rtoImpactHours) : null,
        rpoImpactMinutes:
          rpoImpactMinutes != null ? Number(rpoImpactMinutes) : null,
        notes: notes ? String(notes) : null,
      },
    });

    return res.status(201).json(strategy);
  } catch (error) {
    appLogger.error("Error creating backup strategy", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/backup-strategies", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { serviceId } = req.query;
    const filters: any = { tenantId };
    if (serviceId) filters.serviceId = String(serviceId);

    const strategies = await prisma.backupStrategy.findMany({
      where: filters,
      include: {
        service: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(strategies);
  } catch (error) {
    appLogger.error("Error fetching backup strategies", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/security-policies",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { name, policyType, classification, scope, controls, reviewFrequencyDays, owner, serviceIds } =
      req.body || {};

    if (!name || !policyType) {
      return res.status(400).json({ error: "name et policyType sont requis" });
    }

    const validatedServices: string[] = [];
    if (Array.isArray(serviceIds)) {
      const services = await prisma.service.findMany({
        where: { tenantId, id: { in: serviceIds } },
        select: { id: true },
      });
      validatedServices.push(...services.map((s) => s.id));
      if (validatedServices.length !== serviceIds.length) {
        return res.status(400).json({ error: "Certaines références de services sont invalides" });
      }
    }

    const policy = await prisma.securityPolicy.create({
      data: {
        tenantId,
        name: String(name).trim(),
        policyType: String(policyType).trim(),
        classification: classification ? String(classification) : null,
        scope: scope ? String(scope) : null,
        controls: controls ? String(controls) : null,
        reviewFrequencyDays: reviewFrequencyDays ? Number(reviewFrequencyDays) : null,
        owner: owner ? String(owner) : null,
        services: {
          create: validatedServices.map((id) => ({ tenantId, serviceId: id })),
        },
      },
      include: { services: true },
    });

    return res.status(201).json(policy);
  } catch (error) {
    appLogger.error("Error creating security policy", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/security-policies", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const policies = await prisma.securityPolicy.findMany({
      where: { tenantId },
      include: {
        services: {
          include: { service: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.json(policies);
  } catch (error) {
    appLogger.error("Error fetching security policies", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/dependency-cycles",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { label, severity, notes, services } = req.body || {};
    if (!label || !Array.isArray(services) || services.length < 2) {
      return res.status(400).json({
        error: "label est requis et au moins 2 services doivent être fournis",
      });
    }

    const serviceIds = services.map((s: any) => s.serviceId).filter(Boolean);
    const existing = await prisma.service.findMany({
      where: { tenantId, id: { in: serviceIds } },
      select: { id: true },
    });
    if (existing.length !== serviceIds.length) {
      return res.status(400).json({ error: "Certaines références de services sont invalides" });
    }

    const cycle = await prisma.dependencyCycle.create({
      data: {
        tenantId,
        label: String(label).trim(),
        severity: severity ? String(severity) : null,
        notes: notes ? String(notes) : null,
        services: {
          create: services.map((s: any) => ({
            tenantId,
            serviceId: s.serviceId,
            roleInCycle: s.roleInCycle ? String(s.roleInCycle) : null,
          })),
        },
      },
      include: {
        services: {
          include: {
            service: true,
          },
        },
      },
    });

    return res.status(201).json(cycle);
  } catch (error) {
    appLogger.error("Error creating dependency cycle", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/dependency-cycles", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const cycles = await prisma.dependencyCycle.findMany({
      where: { tenantId },
      include: {
        services: {
          include: {
            service: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return res.json(cycles);
  } catch (error) {
    appLogger.error("Error fetching dependency cycles", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
