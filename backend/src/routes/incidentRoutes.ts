import { appLogger } from "../utils/logger.js";
import { Router } from "express";
import prisma from "../prismaClient.js";
import { Prisma } from "@prisma/client";
import type { TenantRequest } from "../middleware/tenantMiddleware.js";
import { requireRole } from "../middleware/tenantMiddleware.js";
import { notifyIncidentEvent } from "../services/incidentNotificationService.js";
import { toPrismaJson } from "../utils/prismaJson.js";

const router = Router();

const INCIDENT_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
const CHANNEL_TYPES = ["EMAIL", "SLACK", "TEAMS", "SIEM", "TICKETING", "CHATOPS"] as const;

function normalizeStatus(value: string) {
  return value.trim().toUpperCase();
}

function parseDetectedAt(input: any) {
  if (!input) return new Date();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("date de détection invalide");
  }
  return parsed;
}

async function validateServiceIds(tenantId: string, serviceIds: string[]) {
  if (serviceIds.length === 0) return [];
  const services = await prisma.service.findMany({
    where: { tenantId, id: { in: serviceIds } },
    select: { id: true },
  });
  if (services.length !== serviceIds.length) {
    throw new Error("Certains services impactés sont invalides");
  }
  return services.map((service) => service.id);
}

async function validateDocumentIds(tenantId: string, documentIds: string[]) {
  if (documentIds.length === 0) return [];
  const documents = await prisma.document.findMany({
    where: { tenantId, id: { in: documentIds } },
    select: { id: true },
  });
  if (documents.length !== documentIds.length) {
    throw new Error("Certains documents associés sont invalides");
  }
  return documents.map((document) => document.id);
}

router.get("/dashboard", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const incidents = await prisma.incident.findMany({
      where: { tenantId },
      select: { status: true },
    });

    const summary = incidents.reduce(
      (acc, incident) => {
        acc.total += 1;
        const key = normalizeStatus(incident.status);
        if (key === "OPEN") acc.open += 1;
        if (key === "IN_PROGRESS") acc.inProgress += 1;
        if (key === "RESOLVED") acc.resolved += 1;
        if (key === "CLOSED") acc.closed += 1;
        return acc;
      },
      { total: 0, open: 0, inProgress: 0, resolved: 0, closed: 0 }
    );

    const recentIncidents = await prisma.incident.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: {
        services: { include: { service: true } },
      },
    });

    const recentActions = await prisma.incidentAction.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: {
        incident: { select: { id: true, title: true, status: true } },
      },
    });

    return res.json({ summary, recentIncidents, recentActions });
  } catch (error: any) {
    appLogger.error("Error fetching incident dashboard", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/notification-channels", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const channels = await prisma.notificationChannel.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    });

    return res.json(channels);
  } catch (error: any) {
    appLogger.error("Error fetching notification channels", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/notification-channels",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const { type, label, isEnabled, n8nWebhookUrl, configuration } = req.body || {};
      if (!type || !CHANNEL_TYPES.includes(String(type).toUpperCase() as any)) {
        return res.status(400).json({
          error: `type doit être parmi ${CHANNEL_TYPES.join(", ")}`,
        });
      }
      if (!n8nWebhookUrl) {
        return res.status(400).json({ error: "n8nWebhookUrl est requis" });
      }

      const channel = await prisma.notificationChannel.create({
        data: {
          tenantId,
          type: String(type).toUpperCase(),
          label: label ? String(label) : null,
          isEnabled: isEnabled === undefined ? true : Boolean(isEnabled),
          n8nWebhookUrl: String(n8nWebhookUrl),
          configuration: toPrismaJson(configuration ?? {}),
        },
      });

      return res.status(201).json(channel);
    } catch (error: any) {
      appLogger.error("Error creating notification channel", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.patch(
  "/notification-channels/:id",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: "id est requis" });
      }
      const existing = await prisma.notificationChannel.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        return res.status(404).json({ error: "Canal introuvable" });
      }

      const { label, isEnabled, n8nWebhookUrl, configuration } = req.body || {};

      const resolvedConfiguration =
        configuration === null
          ? Prisma.DbNull
          : configuration !== undefined
            ? toPrismaJson(configuration)
            : existing.configuration === null
              ? Prisma.DbNull
              : existing.configuration;

      const updated = await prisma.notificationChannel.update({
        where: { id },
        data: {
          label: label !== undefined ? (label ? String(label) : null) : existing.label,
          isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : existing.isEnabled,
          n8nWebhookUrl:
            n8nWebhookUrl !== undefined ? String(n8nWebhookUrl) : existing.n8nWebhookUrl,
          configuration: resolvedConfiguration,
        },
      });

      return res.json(updated);
    } catch (error: any) {
      appLogger.error("Error updating notification channel", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const incidents = await prisma.incident.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      include: {
        services: { include: { service: true } },
        documents: { include: { document: true } },
        actions: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });

    return res.json(incidents);
  } catch (error: any) {
    appLogger.error("Error fetching incidents", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "id est requis" });
    }
    const incident = await prisma.incident.findFirst({
      where: { id, tenantId },
      include: {
        services: { include: { service: true } },
        documents: { include: { document: true } },
        actions: { orderBy: { createdAt: "desc" } },
      },
    });

    if (!incident) {
      return res.status(404).json({ error: "Incident introuvable" });
    }

    return res.json(incident);
  } catch (error: any) {
    appLogger.error("Error fetching incident", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const {
        title,
        description,
        status,
        detectedAt,
        responsibleTeam,
        serviceIds,
        documentIds,
      } = req.body || {};

      if (!title) {
        return res.status(400).json({ error: "title est requis" });
      }

      const normalizedStatus = status ? normalizeStatus(String(status)) : "OPEN";
      if (!INCIDENT_STATUSES.includes(normalizedStatus as any)) {
        return res.status(400).json({
          error: `status doit être parmi ${INCIDENT_STATUSES.join(", ")}`,
        });
      }

      const parsedDetectedAt = parseDetectedAt(detectedAt);

      const validatedServices = await validateServiceIds(
        tenantId,
        Array.isArray(serviceIds) ? serviceIds.map(String) : []
      );
      const validatedDocuments = await validateDocumentIds(
        tenantId,
        Array.isArray(documentIds) ? documentIds.map(String) : []
      );

      const incident = await prisma.incident.create({
        data: {
          tenantId,
          title: String(title).trim(),
          description: description ? String(description) : null,
          status: normalizedStatus,
          detectedAt: parsedDetectedAt,
          responsibleTeam: responsibleTeam ? String(responsibleTeam) : null,
          services: {
            create: validatedServices.map((serviceId) => ({
              tenantId,
              serviceId,
            })),
          },
          documents: {
            create: validatedDocuments.map((documentId) => ({
              tenantId,
              documentId,
            })),
          },
          actions: {
            create: {
              tenantId,
              actionType: "CREATED",
              description: "Incident créé",
              metadata: {
                status: normalizedStatus,
              },
            },
          },
        },
        include: {
          services: { include: { service: true } },
          documents: { include: { document: true } },
          actions: { orderBy: { createdAt: "desc" }, take: 5 },
        },
      });

      await notifyIncidentEvent({
        event: "incident.created",
        tenantId,
        incidentId: incident.id,
        changeSummary: ["Incident créé"],
      });

      return res.status(201).json(incident);
    } catch (error: any) {
      appLogger.error("Error creating incident", error);
      if (error?.message?.includes("date de détection")) {
        return res.status(400).json({ error: error.message });
      }
      if (error?.message?.includes("services impactés") || error?.message?.includes("documents")) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.patch(
  "/:id",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: "id est requis" });
      }
      const existing = await prisma.incident.findFirst({
        where: { id, tenantId },
        include: {
          services: true,
          documents: true,
        },
      });

      if (!existing) {
        return res.status(404).json({ error: "Incident introuvable" });
      }

      const {
        title,
        description,
        status,
        detectedAt,
        responsibleTeam,
        serviceIds,
        documentIds,
      } = req.body || {};

      const updates: Record<string, any> = {};
      const changeSummary: string[] = [];

      if (title !== undefined) {
        updates.title = String(title).trim();
        if (updates.title !== existing.title) {
          changeSummary.push("Titre mis à jour");
        }
      }
      if (description !== undefined) {
        updates.description = description ? String(description) : null;
        if (updates.description !== existing.description) {
          changeSummary.push("Description mise à jour");
        }
      }
      if (status !== undefined) {
        const normalizedStatus = normalizeStatus(String(status));
        if (!INCIDENT_STATUSES.includes(normalizedStatus as any)) {
          return res.status(400).json({
            error: `status doit être parmi ${INCIDENT_STATUSES.join(", ")}`,
          });
        }
        updates.status = normalizedStatus;
        if (normalizedStatus !== existing.status) {
          changeSummary.push(`Statut: ${existing.status} → ${normalizedStatus}`);
        }
      }
      if (detectedAt !== undefined) {
        const parsedDetectedAt = parseDetectedAt(detectedAt);
        updates.detectedAt = parsedDetectedAt;
        if (parsedDetectedAt.toISOString() !== existing.detectedAt.toISOString()) {
          changeSummary.push("Date de détection mise à jour");
        }
      }
      if (responsibleTeam !== undefined) {
        updates.responsibleTeam = responsibleTeam ? String(responsibleTeam) : null;
        if (updates.responsibleTeam !== existing.responsibleTeam) {
          changeSummary.push("Équipe responsable mise à jour");
        }
      }

      const shouldUpdateServices = Array.isArray(serviceIds);
      const shouldUpdateDocuments = Array.isArray(documentIds);

      const validatedServices = shouldUpdateServices
        ? await validateServiceIds(tenantId, serviceIds.map(String))
        : [];
      const validatedDocuments = shouldUpdateDocuments
        ? await validateDocumentIds(tenantId, documentIds.map(String))
        : [];

      if (shouldUpdateServices) {
        changeSummary.push(`Services impactés mis à jour (${validatedServices.length})`);
      }
      if (shouldUpdateDocuments) {
        changeSummary.push(`Documents associés mis à jour (${validatedDocuments.length})`);
      }

      const updatedIncident = await prisma.$transaction(async (tx) => {
        if (Object.keys(updates).length > 0) {
          await tx.incident.update({
            where: { id },
            data: updates,
          });
        }

        if (shouldUpdateServices) {
          await tx.incidentService.deleteMany({ where: { incidentId: id, tenantId } });
          if (validatedServices.length > 0) {
            await tx.incidentService.createMany({
              data: validatedServices.map((serviceId) => ({
                tenantId,
                incidentId: id,
                serviceId,
              })),
            });
          }
        }

        if (shouldUpdateDocuments) {
          await tx.incidentDocument.deleteMany({ where: { incidentId: id, tenantId } });
          if (validatedDocuments.length > 0) {
            await tx.incidentDocument.createMany({
              data: validatedDocuments.map((documentId) => ({
                tenantId,
                incidentId: id,
                documentId,
              })),
            });
          }
        }

        await tx.incidentAction.create({
          data: {
            tenantId,
            incidentId: id,
            actionType: "UPDATED",
            description: changeSummary.length ? changeSummary.join(" · ") : "Incident mis à jour",
            metadata: {
              changes: changeSummary,
            },
          },
        });

        return tx.incident.findFirst({
          where: { id, tenantId },
          include: {
            services: { include: { service: true } },
            documents: { include: { document: true } },
            actions: { orderBy: { createdAt: "desc" }, take: 5 },
          },
        });
      });

      if (!updatedIncident) {
        return res.status(404).json({ error: "Incident introuvable" });
      }

      await notifyIncidentEvent({
        event: "incident.updated",
        tenantId,
        incidentId: updatedIncident.id,
        changeSummary,
      });

      return res.json(updatedIncident);
    } catch (error: any) {
      appLogger.error("Error updating incident", error);
      if (error?.message?.includes("date de détection")) {
        return res.status(400).json({ error: error.message });
      }
      if (error?.message?.includes("services impactés") || error?.message?.includes("documents")) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get("/:id/actions", async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(500).json({ error: "Tenant not resolved" });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: "id est requis" });
    }
    const actions = await prisma.incidentAction.findMany({
      where: { tenantId, incidentId: id },
      orderBy: { createdAt: "desc" },
    });

    return res.json(actions);
  } catch (error: any) {
    appLogger.error("Error fetching incident actions", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/:id/actions",
  requireRole("OPERATOR"),
  async (req: TenantRequest, res) => {
    try {
      const tenantId = req.tenantId;
      if (!tenantId) {
        return res.status(500).json({ error: "Tenant not resolved" });
      }

      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: "id est requis" });
      }
      const { actionType, description } = req.body || {};

      if (!actionType) {
        return res.status(400).json({ error: "actionType est requis" });
      }

      const incident = await prisma.incident.findFirst({ where: { id, tenantId } });
      if (!incident) {
        return res.status(404).json({ error: "Incident introuvable" });
      }

      const action = await prisma.incidentAction.create({
        data: {
          tenantId,
          incidentId: id,
          actionType: String(actionType).toUpperCase(),
          description: description ? String(description) : null,
        },
      });

      return res.status(201).json(action);
    } catch (error: any) {
      appLogger.error("Error creating incident action", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
