import prisma from "../prismaClient.js";
import { Prisma, PrismaClient } from "@prisma/client";

export type SuggestionStatus = "PENDING" | "APPROVED" | "REJECTED";
export type SuggestionType =
  | "SERVICE"
  | "INFRA"
  | "DEPENDENCY"
  | "CONTINUITY"
  | "BIA_PROCESS"
  | "REGULATION"
  | "RISK"
  | "TEST_EXERCISE";

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient | any;

type SuggestionInput = {
  suggestionType: SuggestionType;
  label: string;
  data: Record<string, unknown>;
};

const DEFAULT_SERVICE_TYPE = "DISCOVERED";
const DEFAULT_SERVICE_CRITICALITY = "MEDIUM";
const DEFAULT_DEPENDENCY_TYPE = "IMPLICIT_DOCUMENT";
const DEFAULT_INFRA_TYPE = "DISCOVERED";

function normalizeLabel(value: string): string {
  return (value || "").trim();
}

function addSuggestion(
  suggestions: SuggestionInput[],
  seen: Set<string>,
  suggestionType: SuggestionType,
  label: string,
  data: Record<string, unknown>
) {
  const normalized = normalizeLabel(label);
  if (!normalized) return;
  const key = `${suggestionType}::${normalized.toLowerCase()}`;
  if (seen.has(key)) return;
  seen.add(key);
  suggestions.push({ suggestionType, label: normalized, data });
}

export async function createExtractionSuggestions(params: {
  tenantId: string;
  documentId: string;
  metadata: Record<string, unknown>;
  mapping: {
    services: string[];
    dependencies: Array<{ from?: string; to: string; targetIsInfra: boolean }>;
    infra: Array<{ name: string; type: string; provider?: string }>;
  };
  anchoredDependencies: Array<{ from: string; to: string; targetIsInfra: boolean }>;
  prismaClient?: PrismaClientOrTx;
}) {
  const prismaClient = (params.prismaClient ?? prisma) as any;
  const suggestions: SuggestionInput[] = [];
  const seen = new Set<string>();

  params.mapping.services.forEach((serviceName) => {
    addSuggestion(suggestions, seen, "SERVICE", serviceName, { name: serviceName });
  });

  params.mapping.infra.forEach((infra) => {
    addSuggestion(suggestions, seen, "INFRA", infra.name, {
      name: infra.name,
      type: infra.type,
      provider: infra.provider ?? null,
    });
  });

  params.anchoredDependencies.forEach((dep) => {
    addSuggestion(suggestions, seen, "DEPENDENCY", `${dep.from} -> ${dep.to}`, {
      from: dep.from,
      to: dep.to,
      targetIsInfra: dep.targetIsInfra,
    });
  });

  const rtoHours = params.metadata.rtoHours as number | undefined;
  const rpoMinutes = params.metadata.rpoMinutes as number | undefined;
  const mtpdHours = params.metadata.mtpdHours as number | undefined;
  const slas = Array.isArray(params.metadata.slas) ? params.metadata.slas : [];
  if (
    (rtoHours != null || rpoMinutes != null || mtpdHours != null || slas.length > 0) &&
    params.mapping.services.length > 0
  ) {
    params.mapping.services.forEach((serviceName) => {
      addSuggestion(suggestions, seen, "CONTINUITY", `Continuité ${serviceName}`, {
        serviceName,
        rtoHours: rtoHours ?? null,
        rpoMinutes: rpoMinutes ?? null,
        mtpdHours: mtpdHours ?? null,
        slas,
      });
    });
  }

  const criticalProcesses = Array.isArray(params.metadata.criticalProcesses)
    ? params.metadata.criticalProcesses
    : [];
  (criticalProcesses as string[]).forEach((processName) => {
    addSuggestion(suggestions, seen, "BIA_PROCESS", processName, { name: processName });
  });

  const regulations = Array.isArray(params.metadata.regulations) ? params.metadata.regulations : [];
  (regulations as string[]).forEach((regulation) => {
    addSuggestion(suggestions, seen, "REGULATION", regulation, { name: regulation });
  });

  const risks = Array.isArray(params.metadata.risks) ? params.metadata.risks : [];
  (risks as string[]).forEach((risk) => {
    addSuggestion(suggestions, seen, "RISK", risk, { title: risk });
  });

  const testsExercises = Array.isArray(params.metadata.testsExercises)
    ? params.metadata.testsExercises
    : [];
  (testsExercises as string[]).forEach((test) => {
    addSuggestion(suggestions, seen, "TEST_EXERCISE", test, { title: test });
  });

  await prismaClient.documentExtractionSuggestion.deleteMany({
    where: { tenantId: params.tenantId, documentId: params.documentId },
  });

  if (suggestions.length === 0) {
    return { created: 0 };
  }

  const result = await prismaClient.documentExtractionSuggestion.createMany({
    data: suggestions.map((suggestion) => ({
      tenantId: params.tenantId,
      documentId: params.documentId,
      suggestionType: suggestion.suggestionType,
      label: suggestion.label,
      data: suggestion.data,
      status: "PENDING",
    })),
  });

  return { created: result.count };
}

async function ensureService(
  tx: PrismaClientOrTx,
  tenantId: string,
  name: string
) {
  const existing = await tx.service.findFirst({ where: { tenantId, name } });
  if (existing) return existing;
  return tx.service.create({
    data: {
      tenantId,
      name,
      type: DEFAULT_SERVICE_TYPE,
      criticality: DEFAULT_SERVICE_CRITICALITY,
      description: "Créé via validation d'extraction",
    },
  });
}

async function ensureInfra(
  tx: PrismaClientOrTx,
  tenantId: string,
  payload: { name: string; type?: string | null; provider?: string | null }
) {
  const existing = await tx.infraComponent.findFirst({
    where: { tenantId, name: payload.name },
  });
  if (existing) return existing;
  return tx.infraComponent.create({
    data: {
      tenantId,
      name: payload.name,
      type: payload.type || DEFAULT_INFRA_TYPE,
      provider: payload.provider ?? null,
      notes: "Composant validé depuis une extraction de document",
    },
  });
}

async function applyContinuity(
  tx: PrismaClientOrTx,
  tenantId: string,
  data: {
    serviceName: string;
    rtoHours?: number | null;
    rpoMinutes?: number | null;
    mtpdHours?: number | null;
    slas?: string[];
  }
) {
  const service = await ensureService(tx, tenantId, data.serviceName);
  const existing = await tx.serviceContinuity.findFirst({
    where: { serviceId: service.id },
  });
  const notes = Array.isArray(data.slas) && data.slas.length > 0
    ? `SLAs détectés: ${data.slas.join(" | ").slice(0, 600)}`
    : null;

  const payload: Prisma.ServiceContinuityUncheckedUpdateInput = {};
  if (data.rtoHours != null) payload.rtoHours = data.rtoHours;
  if (data.rpoMinutes != null) payload.rpoMinutes = data.rpoMinutes;
  if (data.mtpdHours != null) payload.mtpdHours = data.mtpdHours;
  if (notes) payload.notes = notes;

  if (existing) {
    await tx.serviceContinuity.update({
      where: { serviceId: service.id },
      data: payload,
    });
  } else if (data.rtoHours != null || data.rpoMinutes != null || data.mtpdHours != null || notes) {
    await tx.serviceContinuity.create({
      data: {
        serviceId: service.id,
        rtoHours: data.rtoHours ?? data.mtpdHours ?? 0,
        rpoMinutes: data.rpoMinutes ?? 0,
        mtpdHours: data.mtpdHours ?? data.rtoHours ?? 0,
        notes,
      },
    });
  }
}

async function applyDependency(
  tx: PrismaClientOrTx,
  tenantId: string,
  data: { from: string; to: string; targetIsInfra: boolean }
) {
  const fromService = await ensureService(tx, tenantId, data.from);
  if (data.targetIsInfra) {
    const infra = await ensureInfra(tx, tenantId, { name: data.to, type: DEFAULT_INFRA_TYPE });
    const existing = await tx.serviceInfraLink.findFirst({
      where: { tenantId, serviceId: fromService.id, infraId: infra.id },
    });
    if (!existing) {
      await tx.serviceInfraLink.create({
        data: {
          tenantId,
          serviceId: fromService.id,
          infraId: infra.id,
        },
      });
    }
    return;
  }

  const toService = await ensureService(tx, tenantId, data.to);
  const existing = await tx.serviceDependency.findFirst({
    where: { tenantId, fromServiceId: fromService.id, toServiceId: toService.id },
  });
  if (!existing) {
    await tx.serviceDependency.create({
      data: {
        tenantId,
        fromServiceId: fromService.id,
        toServiceId: toService.id,
        dependencyType: DEFAULT_DEPENDENCY_TYPE,
      },
    });
  }
}

async function applyBiaProcess(
  tx: PrismaClientOrTx,
  tenantId: string,
  data: { name: string; description?: string | null }
) {
  const existing = await tx.businessProcess.findFirst({
    where: { tenantId, name: data.name },
  });
  if (existing) return;
  await tx.businessProcess.create({
    data: {
      tenantId,
      name: data.name,
      description: data.description ?? null,
      owners: null,
      financialImpactLevel: 1,
      regulatoryImpactLevel: 1,
      interdependencies: null,
      rtoHours: 0,
      rpoMinutes: 0,
      mtpdHours: 0,
      impactScore: 0,
      criticalityScore: 0,
    },
  });
}

async function applyRegulation(
  tx: PrismaClientOrTx,
  tenantId: string,
  data: { name: string }
) {
  const existing = await tx.securityPolicy.findFirst({
    where: { tenantId, name: data.name },
  });
  if (existing) return;
  await tx.securityPolicy.create({
    data: {
      tenantId,
      name: data.name,
      policyType: "REGULATION",
      classification: "REGULATORY",
      scope: null,
      controls: null,
      reviewFrequencyDays: null,
      owner: null,
    },
  });
}

async function applyRisk(
  tx: PrismaClientOrTx,
  tenantId: string,
  data: { title: string; threatType?: string | null; probability?: number; impact?: number }
) {
  const existing = await tx.risk.findFirst({ where: { tenantId, title: data.title } });
  if (existing) return;
  await tx.risk.create({
    data: {
      tenantId,
      title: data.title,
      description: null,
      threatType: data.threatType ?? "UNSPECIFIED",
      probability: Number.isFinite(data.probability) ? data.probability! : 3,
      impact: Number.isFinite(data.impact) ? data.impact! : 3,
      status: "IDENTIFIED",
      owner: null,
      processName: null,
      serviceId: null,
    },
  });
}

async function applyTestExercise(
  tx: PrismaClientOrTx,
  tenantId: string,
  documentId: string,
  data: { title: string; description?: string | null; exerciseType?: string | null; occurredAt?: string | null }
) {
  const existing = await tx.exerciseEvidence.findFirst({
    where: { tenantId, title: data.title },
  });
  if (existing) return;

  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : null;
  await tx.exerciseEvidence.create({
    data: {
      tenantId,
      documentId,
      title: data.title,
      description: data.description ?? null,
      exerciseType: data.exerciseType ?? null,
      occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
    },
  });
}

export async function listExtractionSuggestions(params: {
  tenantId: string;
  documentId: string;
  status?: SuggestionStatus | null;
}) {
  const prismaClient = prisma as any;
  return prismaClient.documentExtractionSuggestion.findMany({
    where: {
      tenantId: params.tenantId,
      documentId: params.documentId,
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function approveExtractionSuggestions(params: {
  tenantId: string;
  documentId: string;
  suggestionIds?: string[];
  reviewNotes?: string | null;
}) {
  const prismaClient = prisma as any;
  const suggestions = await prismaClient.documentExtractionSuggestion.findMany({
    where: {
      tenantId: params.tenantId,
      documentId: params.documentId,
      status: "PENDING",
      ...(params.suggestionIds && params.suggestionIds.length > 0
        ? { id: { in: params.suggestionIds } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  if (suggestions.length === 0) {
    return { approved: 0 };
  }

  await prismaClient.$transaction(async (tx) => {
    for (const suggestion of suggestions) {
      const data = suggestion.data as Record<string, unknown>;
      switch (suggestion.suggestionType as SuggestionType) {
        case "SERVICE":
          await ensureService(tx, params.tenantId, String(data.name || suggestion.label));
          break;
        case "INFRA":
          await ensureInfra(tx, params.tenantId, {
            name: String(data.name || suggestion.label),
            type: (data.type as string | null) ?? null,
            provider: (data.provider as string | null) ?? null,
          });
          break;
        case "DEPENDENCY":
          if (data.from && data.to) {
            await applyDependency(tx, params.tenantId, {
              from: String(data.from),
              to: String(data.to),
              targetIsInfra: Boolean(data.targetIsInfra),
            });
          }
          break;
        case "CONTINUITY":
          if (data.serviceName) {
            await applyContinuity(tx, params.tenantId, {
              serviceName: String(data.serviceName),
              rtoHours: typeof data.rtoHours === "number" ? data.rtoHours : null,
              rpoMinutes: typeof data.rpoMinutes === "number" ? data.rpoMinutes : null,
              mtpdHours: typeof data.mtpdHours === "number" ? data.mtpdHours : null,
              slas: Array.isArray(data.slas) ? (data.slas as string[]) : [],
            });
          }
          break;
        case "BIA_PROCESS":
          await applyBiaProcess(tx, params.tenantId, {
            name: String(data.name || suggestion.label),
            description: (data.description as string | null) ?? null,
          });
          break;
        case "REGULATION":
          await applyRegulation(tx, params.tenantId, {
            name: String(data.name || suggestion.label),
          });
          break;
        case "RISK":
          await applyRisk(tx, params.tenantId, {
            title: String(data.title || suggestion.label),
            threatType: (data.threatType as string | null) ?? null,
            probability: typeof data.probability === "number" ? data.probability : undefined,
            impact: typeof data.impact === "number" ? data.impact : undefined,
          });
          break;
        case "TEST_EXERCISE":
          await applyTestExercise(tx, params.tenantId, params.documentId, {
            title: String(data.title || suggestion.label),
            description: (data.description as string | null) ?? null,
            exerciseType: (data.exerciseType as string | null) ?? null,
            occurredAt: (data.occurredAt as string | null) ?? null,
          });
          break;
        default:
          break;
      }
    }

    await tx.documentExtractionSuggestion.updateMany({
      where: { id: { in: suggestions.map((s) => s.id) } },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewNotes: params.reviewNotes ?? null,
      },
    });
  });

  return { approved: suggestions.length };
}

export async function rejectExtractionSuggestions(params: {
  tenantId: string;
  documentId: string;
  suggestionIds?: string[];
  reviewNotes?: string | null;
}) {
  const prismaClient = prisma as any;
  const result = await prismaClient.documentExtractionSuggestion.updateMany({
    where: {
      tenantId: params.tenantId,
      documentId: params.documentId,
      status: "PENDING",
      ...(params.suggestionIds && params.suggestionIds.length > 0
        ? { id: { in: params.suggestionIds } }
        : {}),
    },
    data: {
      status: "REJECTED",
      reviewedAt: new Date(),
      reviewNotes: params.reviewNotes ?? null,
    },
  });

  return { rejected: result.count };
}
