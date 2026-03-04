import { appLogger } from "../utils/logger.js";
// ============================================================
// BIA Resilience Routes — Auto-generated BIA from graph
// ============================================================

import { Router } from 'express';
import prisma from '../prismaClient.js';
import type { TenantRequest } from '../middleware/tenantMiddleware.js';
import * as GraphService from '../graph/graphService.js';
import { requireFeature } from '../middleware/licenseMiddleware.js';
import { calculateBlastRadius } from '../graph/blastRadiusEngine.js';
import { biaSuggestionService, validateRTORPOConsistency } from '../bia/services/bia-suggestion.service.js';
import type { InfraNodeAttrs } from '../graph/types.js';
import { resolveCompanyFinancialProfile } from '../services/company-financial-profile.service.js';
import { generateAndPersistBiaReport } from '../services/biaAutoGenerationService.js';
import {
  calculateServiceDowntimeCosts,
  normalizeCriticalityLevel,
  type ServiceDowntimeCost,
} from '../services/pricing/downtimeDistribution.js';

const router = Router();

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type BiaFinancialScope =
  | 'not_configured'
  | 'profile_global'
  | 'custom'
  | 'blast_radius'
  | 'fallback_criticality';

type FinancialOverrideEntry = {
  customCostPerHour: number;
  justification: string | null;
  validatedBy: string | null;
  validatedAt: Date | null;
};

function resolveConfiguredDowntimeCost(
  profile: Awaited<ReturnType<typeof resolveCompanyFinancialProfile>>,
): number | null {
  if (!profile.isConfigured) return null;
  const value = Number(profile.customDowntimeCostPerHour || profile.hourlyDowntimeCost || 0);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function normalizeRecoveryTier(rawTier: number | null | undefined): number {
  const parsed = Number(rawTier);
  if (!Number.isFinite(parsed)) return 4;
  const rounded = Math.round(parsed);
  if (rounded >= 1 && rounded <= 4) return rounded;
  return 4;
}

function capRtoRpoByTier(
  tier: number | null | undefined,
  input: { rtoMinutes: number | null | undefined; rpoMinutes: number | null | undefined },
): { rtoMinutes: number | null; rpoMinutes: number | null } {
  const normalizedRto =
    typeof input.rtoMinutes === 'number' && Number.isFinite(input.rtoMinutes)
      ? Math.max(0, Math.round(input.rtoMinutes))
      : null;
  const normalizedRpo =
    typeof input.rpoMinutes === 'number' && Number.isFinite(input.rpoMinutes)
      ? Math.max(0, Math.round(input.rpoMinutes))
      : null;

  if (normalizedRto == null && normalizedRpo == null) {
    return { rtoMinutes: null, rpoMinutes: null };
  }

  const [bounded] = validateRTORPOConsistency([
    {
      tier: normalizeRecoveryTier(tier),
      rtoMinutes: normalizedRto ?? 0,
      rpoMinutes: normalizedRpo ?? 0,
    },
  ]);
  const safeBounded = bounded ?? {
    tier: normalizeRecoveryTier(tier),
    rtoMinutes: normalizedRto ?? 0,
    rpoMinutes: normalizedRpo ?? 0,
  };

  return {
    rtoMinutes: normalizedRto == null ? null : safeBounded.rtoMinutes,
    rpoMinutes: normalizedRpo == null ? null : safeBounded.rpoMinutes,
  };
}

function resolveProcessCriticalityLevel(input: {
  process: {
    criticalityScore: number;
    impactCategory: string | null;
    recoveryTier: number;
  };
  node?: InfraNodeAttrs;
}): 'critical' | 'high' | 'medium' | 'low' {
  const impactCategory = String(input.process.impactCategory || '').toLowerCase();
  if (impactCategory.includes('tier1') || impactCategory.includes('mission') || impactCategory.includes('critical')) {
    return 'critical';
  }
  if (impactCategory.includes('tier2') || impactCategory.includes('business') || impactCategory.includes('high')) {
    return 'high';
  }
  if (impactCategory.includes('tier3') || impactCategory.includes('important') || impactCategory.includes('medium')) {
    return 'medium';
  }
  if (impactCategory.includes('tier4') || impactCategory.includes('low')) {
    return 'low';
  }
  if (input.process.recoveryTier === 1) return 'critical';
  if (input.process.recoveryTier === 2) return 'high';
  if (input.process.recoveryTier === 3) return 'medium';
  if (input.process.recoveryTier === 4) return 'low';

  const nodeCriticality = normalizeCriticalityLevel(input.node?.impactCategory || input.node?.metadata?.criticality);
  if (nodeCriticality) return nodeCriticality;
  return normalizeCriticalityLevel(input.process.criticalityScore);
}

function buildDowntimeCostMapForProcesses(input: {
  graph: Awaited<ReturnType<typeof GraphService.getGraph>>;
  processes: Array<{
    serviceNodeId: string;
    serviceName: string;
    criticalityScore: number;
    impactCategory: string | null;
    recoveryTier: number;
  }>;
  profile: Awaited<ReturnType<typeof resolveCompanyFinancialProfile>>;
  overrideByNodeId: Map<string, FinancialOverrideEntry>;
}): Map<string, ServiceDowntimeCost> {
  const graphNodes = input.graph.nodes().map((id) => input.graph.getNodeAttributes(id) as InfraNodeAttrs);
  const graphEdges = input.graph.edges().map((edgeKey) => {
    const edgeAttrs = input.graph.getEdgeAttributes(edgeKey) as { type?: string };
    return {
      sourceId: input.graph.source(edgeKey),
      targetId: input.graph.target(edgeKey),
      type: String(edgeAttrs.type || ''),
    };
  });
  const blastResults = calculateBlastRadius(graphNodes, graphEdges);
  const graphNodeById = new Map(graphNodes.map((node) => [node.id, node]));

  const services = input.processes.map((process) => {
    const node = graphNodeById.get(process.serviceNodeId);
    const criticality = node
      ? resolveProcessCriticalityLevel({ process, node })
      : resolveProcessCriticalityLevel({ process });
    return {
      nodeId: process.serviceNodeId,
      name: process.serviceName,
      criticality,
      nodeType: node?.type ?? null,
      provider: node?.provider ?? null,
      metadata: node?.metadata ?? {},
      estimatedMonthlyCost: node?.estimatedMonthlyCost ?? null,
    };
  });

  const serviceOverrides = Array.from(input.overrideByNodeId.entries()).map(([nodeId, override]) => ({
    nodeId,
    customDowntimeCostPerHour: override.customCostPerHour,
  }));
  const distributed = calculateServiceDowntimeCosts(blastResults, services, {
    estimatedDowntimeCostPerHour: resolveConfiguredDowntimeCost(input.profile),
    serviceOverrides,
  });

  return new Map(distributed.map((item) => [item.serviceNodeId, item]));
}

function resolveBiaFinancialForService(input: {
  nodeId: string;
  costByNodeId: Map<string, ServiceDowntimeCost>;
}): {
  financialImpactPerHour: number | null;
  financialScope: BiaFinancialScope;
  financialScopeLabel: string;
  financialConfidence: 'user_defined' | 'estimated' | 'low_confidence';
  financialSources: string[];
  downtimeCostSource: ServiceDowntimeCost['source'];
  downtimeCostPerHour: number;
  downtimeCostRationale: string;
  blastRadius?: ServiceDowntimeCost['blastRadius'];
} {
  const resolved = input.costByNodeId.get(input.nodeId);
  if (!resolved) {
    return {
      financialImpactPerHour: null,
      financialScope: 'not_configured',
      financialScopeLabel: 'non configure',
      financialConfidence: 'low_confidence',
      financialSources: ['Non estime - configurez le profil financier'],
      downtimeCostSource: 'not_configured',
      downtimeCostPerHour: 0,
      downtimeCostRationale: 'Profil financier non configure',
    };
  }

  if (resolved.source === 'override') {
    return {
      financialImpactPerHour: resolved.downtimeCostPerHour,
      financialScope: 'custom',
      financialScopeLabel: resolved.sourceLabel,
      financialConfidence: 'user_defined',
      financialSources: [resolved.rationale],
      downtimeCostSource: resolved.source,
      downtimeCostPerHour: resolved.downtimeCostPerHour,
      downtimeCostRationale: resolved.rationale,
      ...(resolved.blastRadius ? { blastRadius: resolved.blastRadius } : {}),
    };
  }

  if (resolved.source === 'blast_radius') {
    return {
      financialImpactPerHour: resolved.downtimeCostPerHour,
      financialScope: 'blast_radius',
      financialScopeLabel: resolved.sourceLabel,
      financialConfidence: 'estimated',
      financialSources: [resolved.rationale],
      downtimeCostSource: resolved.source,
      downtimeCostPerHour: resolved.downtimeCostPerHour,
      downtimeCostRationale: resolved.rationale,
      ...(resolved.blastRadius ? { blastRadius: resolved.blastRadius } : {}),
    };
  }

  if (resolved.source === 'fallback_criticality') {
    return {
      financialImpactPerHour: resolved.downtimeCostPerHour,
      financialScope: 'fallback_criticality',
      financialScopeLabel: resolved.sourceLabel,
      financialConfidence: 'low_confidence',
      financialSources: [resolved.rationale],
      downtimeCostSource: resolved.source,
      downtimeCostPerHour: resolved.downtimeCostPerHour,
      downtimeCostRationale: resolved.rationale,
      ...(resolved.blastRadius ? { blastRadius: resolved.blastRadius } : {}),
    };
  }

  if (resolved.source === 'not_configured') {
    return {
      financialImpactPerHour: null,
      financialScope: 'not_configured',
      financialScopeLabel: resolved.sourceLabel,
      financialConfidence: 'low_confidence',
      financialSources: [resolved.rationale],
      downtimeCostSource: resolved.source,
      downtimeCostPerHour: 0,
      downtimeCostRationale: resolved.rationale,
      ...(resolved.blastRadius ? { blastRadius: resolved.blastRadius } : {}),
    };
  }

  return {
    financialImpactPerHour: null,
    financialScope: 'not_configured',
    financialScopeLabel: 'non configure',
    financialConfidence: 'low_confidence',
    financialSources: ['Non estime - configurez le profil financier'],
    downtimeCostSource: 'not_configured',
    downtimeCostPerHour: 0,
    downtimeCostRationale: 'Profil financier non configure',
  };
}

// ─── POST /bia-resilience/auto-generate — Generate BIA from graph ──────────
router.post('/auto-generate', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const dbReport = await generateAndPersistBiaReport(prisma, tenantId);
    if (!dbReport) {
      return res.status(400).json({ error: 'Graph is empty. Run a discovery scan first.' });
    }

    return res.json(dbReport);
  } catch (error) {
    appLogger.error('Error generating BIA:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Helper: build tier summary from processes ──────────
function buildTiers(processes: Array<{
  recoveryTier?: number;
  tier?: number;
  serviceName: string;
  financialImpactPerHour?: number | null;
}>) {
  const tiers: Record<string, { count: number; services: string[]; totalImpact: number }> = {
    tier1: { count: 0, services: [], totalImpact: 0 },
    tier2: { count: 0, services: [], totalImpact: 0 },
    tier3: { count: 0, services: [], totalImpact: 0 },
    tier4: { count: 0, services: [], totalImpact: 0 },
  };
  for (const p of processes) {
    const tier = p.recoveryTier ?? p.tier ?? 4;
    const key = `tier${tier}` as keyof typeof tiers;
    if (tiers[key]) {
      tiers[key].count++;
      tiers[key].services.push(p.serviceName);
      tiers[key].totalImpact +=
        typeof p.financialImpactPerHour === 'number' && Number.isFinite(p.financialImpactPerHour)
          ? p.financialImpactPerHour
          : 0;
    }
  }
  return tiers;
}

// ─── GET /bia-resilience/entries — BIA entries with tiers (frontend expects this) ──────────
router.get('/entries', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { criticalityScore: 'desc' } } },
    });

    if (!report) {
      return res.json({
        entries: [],
        tiers: buildTiers([]),
      });
    }

    const nodeIds = report.processes.map((process) => process.serviceNodeId);
    const [graph, profile, overrides] = await Promise.all([
      GraphService.getGraph(prisma, tenantId),
      resolveCompanyFinancialProfile(prisma, tenantId),
      prisma.nodeFinancialOverride.findMany({
        where: {
          tenantId,
          ...(nodeIds.length > 0 ? { nodeId: { in: nodeIds } } : {}),
        },
      }),
    ]);
    const overridesByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));
    const downtimeCostByNodeId = buildDowntimeCostMapForProcesses({
      graph,
      processes: report.processes.map((process) => ({
        serviceNodeId: process.serviceNodeId,
        serviceName: process.serviceName,
        criticalityScore: process.criticalityScore,
        impactCategory: process.impactCategory,
        recoveryTier: process.recoveryTier,
      })),
      profile,
      overrideByNodeId: overridesByNodeId,
    });

    const entries = await Promise.all(
      report.processes.map(async (p) => {
        const node = graph.hasNode(p.serviceNodeId)
          ? (graph.getNodeAttributes(p.serviceNodeId) as InfraNodeAttrs)
          : undefined;

        const fallbackNode: InfraNodeAttrs = {
          id: p.serviceNodeId,
          name: p.serviceName,
          type: p.serviceType,
          provider: 'unknown',
          tags: {},
          metadata: {},
          criticalityScore: p.criticalityScore,
        };

        const rawSuggestion = biaSuggestionService.suggestForNode(node ?? fallbackNode, {
          graph,
          explicitCriticalityScore: p.criticalityScore,
          tier: p.recoveryTier,
        });
        const boundedSuggestion = capRtoRpoByTier(p.recoveryTier, {
          rtoMinutes: rawSuggestion.rto,
          rpoMinutes: rawSuggestion.rpo,
        });
        const suggestion = {
          ...rawSuggestion,
          rto: boundedSuggestion.rtoMinutes ?? rawSuggestion.rto,
          rpo: boundedSuggestion.rpoMinutes ?? rawSuggestion.rpo,
        };
        const boundedValidated = capRtoRpoByTier(p.recoveryTier, {
          rtoMinutes: p.validatedRTO,
          rpoMinutes: p.validatedRPO,
        });

        const financialOverride = overridesByNodeId.get(p.serviceNodeId);
        const financialResolution = resolveBiaFinancialForService({
          nodeId: p.serviceNodeId,
          costByNodeId: downtimeCostByNodeId,
        });

        const validated = p.validationStatus === 'validated';
        const metadataRecord =
          node?.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
            ? (node.metadata as Record<string, unknown>)
            : undefined;
        const serviceTypeLabel =
          readString(metadataRecord?.awsService) ??
          readString(metadataRecord?.subType) ??
          p.serviceType;
        const criticalityClassificationRaw = metadataRecord?.criticalityClassification;
        const criticalityClassification =
          isRecord(criticalityClassificationRaw) &&
          Number.isFinite(Number(criticalityClassificationRaw.tier))
            ? {
                tier: Math.max(1, Math.min(4, Math.round(Number(criticalityClassificationRaw.tier)))),
                confidence: Number.isFinite(Number(criticalityClassificationRaw.confidence))
                  ? Number(criticalityClassificationRaw.confidence)
                  : null,
                signals: Array.isArray(criticalityClassificationRaw.signals)
                  ? criticalityClassificationRaw.signals
                      .map((item) => readString(item))
                      .filter((item): item is string => Boolean(item))
                  : [],
                impactCategory: readString(criticalityClassificationRaw.impactCategory),
              }
            : null;

        return {
          id: p.id,
          nodeId: p.serviceNodeId,
          serviceName: p.serviceName,
          serviceType: p.serviceType,
          serviceTypeLabel,
          tier: p.recoveryTier,
          rto: boundedValidated.rtoMinutes,
          rpo: boundedValidated.rpoMinutes,
          mtpd: p.validatedMTPD ?? null,
          rtoSuggested: suggestion.rto,
          rpoSuggested: suggestion.rpo,
          mtpdSuggested: suggestion.mtpd,
          validated,
          suggestion,
          effectiveRto: boundedValidated.rtoMinutes ?? suggestion.rto,
          effectiveRpo: boundedValidated.rpoMinutes ?? suggestion.rpo,
          effectiveMtpd: p.validatedMTPD ?? suggestion.mtpd,
          financialImpactPerHour: financialResolution.financialImpactPerHour,
          financialConfidence: financialResolution.financialConfidence,
          financialSources: financialResolution.financialSources,
          financialIsOverride: financialResolution.financialScope === 'custom',
          financialPrecisionBadge:
            financialResolution.financialScope === 'custom'
              ? 'override_user'
              : financialResolution.financialScope === 'blast_radius'
                ? 'blast_radius'
                : financialResolution.financialScope === 'fallback_criticality'
                  ? 'fallback_criticality'
              : financialResolution.financialScope === 'profile_global'
                ? 'profile_global'
                : 'not_configured',
          financialScope: financialResolution.financialScope,
          financialScopeLabel: financialResolution.financialScopeLabel,
          downtimeCostPerHour: financialResolution.downtimeCostPerHour,
          downtimeCostSource: financialResolution.downtimeCostSource,
          downtimeCostSourceLabel: financialResolution.financialScopeLabel,
          downtimeCostRationale: financialResolution.downtimeCostRationale,
          blastRadius: financialResolution.blastRadius,
          financialOverride: financialOverride
            ? {
                customCostPerHour: financialOverride.customCostPerHour,
                justification: financialOverride.justification,
                validatedBy: financialOverride.validatedBy,
                validatedAt: financialOverride.validatedAt,
              }
            : null,
          dependencies: Array.isArray(p.dependencyChain) ? p.dependencyChain : [],
          criticalityScore: p.criticalityScore,
          impactCategory: p.impactCategory,
          criticalityClassification,
          validationStatus: p.validationStatus,
        };
      }),
    );

    return res.json({
      entries,
      tiers: buildTiers(entries),
    });
  } catch (error) {
    appLogger.error('Error fetching BIA entries:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/summary — BIA summary with tiers ──────────
router.get('/summary', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [report, profile, overrides, graph] = await Promise.all([
      prisma.bIAReport2.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { processes: true },
      }),
      resolveCompanyFinancialProfile(prisma, tenantId),
      prisma.nodeFinancialOverride.findMany({
        where: { tenantId },
        select: {
          nodeId: true,
          customCostPerHour: true,
          justification: true,
          validatedBy: true,
          validatedAt: true,
        },
      }),
      GraphService.getGraph(prisma, tenantId),
    ]);

    if (!report) {
      return res.json({
        totalServices: 0,
        validatedCount: 0,
        tiers: [
          { tier: 1, label: 'Mission Critical', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
          { tier: 2, label: 'Business Critical', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
          { tier: 3, label: 'Important', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
          { tier: 4, label: 'Non-Critical', serviceCount: 0, maxRTO: '0', totalFinancialImpact: 0 },
        ],
      });
    }

    const tierNames: Record<number, string> = {
      1: 'Mission Critical',
      2: 'Business Critical',
      3: 'Important',
      4: 'Non-Critical',
    };
    const overrideByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));
    const downtimeCostByNodeId = buildDowntimeCostMapForProcesses({
      graph,
      processes: report.processes.map((process) => ({
        serviceNodeId: process.serviceNodeId,
        serviceName: process.serviceName,
        criticalityScore: process.criticalityScore,
        impactCategory: process.impactCategory,
        recoveryTier: process.recoveryTier,
      })),
      profile,
      overrideByNodeId,
    });

    const tiers = [1, 2, 3, 4].map(tier => {
      const procs = report.processes.filter(p => p.recoveryTier === tier);
      const maxRTO = procs.length > 0
        ? Math.max(
            ...procs.map((p) => {
              const bounded = capRtoRpoByTier(p.recoveryTier, {
                rtoMinutes: p.validatedRTO ?? p.suggestedRTO,
                rpoMinutes: null,
              });
              return bounded.rtoMinutes ?? 0;
            }),
          )
        : 0;
      const totalFinancialImpact = procs.reduce((sum, process) => {
        const resolved = resolveBiaFinancialForService({
          nodeId: process.serviceNodeId,
          costByNodeId: downtimeCostByNodeId,
        });
        return sum + (resolved.financialImpactPerHour || 0);
      }, 0);
      return {
        tier,
        label: tierNames[tier],
        serviceCount: procs.length,
        maxRTO: String(maxRTO),
        totalFinancialImpact,
      };
    });

    return res.json({
      totalServices: report.processes.length,
      validatedCount: report.processes.filter(p => p.validationStatus === 'validated').length,
      tiers,
    });
  } catch (error) {
    appLogger.error('Error fetching BIA summary:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/csv — Export BIA as CSV ──────────
router.get('/export/csv', requireFeature('api-export'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [report, profile, overrides, graph] = await Promise.all([
      prisma.bIAReport2.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { processes: { orderBy: { recoveryTier: 'asc' } } },
      }),
      resolveCompanyFinancialProfile(prisma, tenantId),
      prisma.nodeFinancialOverride.findMany({
        where: { tenantId },
        select: {
          nodeId: true,
          customCostPerHour: true,
          justification: true,
          validatedBy: true,
          validatedAt: true,
        },
      }),
      GraphService.getGraph(prisma, tenantId),
    ]);
    const overrideByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));
    const downtimeCostByNodeId = buildDowntimeCostMapForProcesses({
      graph,
      processes: (report?.processes || []).map((process) => ({
        serviceNodeId: process.serviceNodeId,
        serviceName: process.serviceName,
        criticalityScore: process.criticalityScore,
        impactCategory: process.impactCategory,
        recoveryTier: process.recoveryTier,
      })),
      profile,
      overrideByNodeId,
    });

    const header = 'Service,Type,Tier,Suggested RTO,Suggested RPO,Suggested MTPD,Validated RTO,Validated RPO,Validated MTPD,Impact Category,Criticality Score,Financial Impact/h,Status\n';
    const rows = (report?.processes || [])
      .map((p) => {
        const resolvedFinancial = resolveBiaFinancialForService({
          nodeId: p.serviceNodeId,
          costByNodeId: downtimeCostByNodeId,
        });
        return [
          `"${p.serviceName}"`,
          p.serviceType,
          p.recoveryTier,
          p.suggestedRTO,
          p.suggestedRPO,
          p.suggestedMTPD,
          p.validatedRTO ?? '',
          p.validatedRPO ?? '',
          p.validatedMTPD ?? '',
          p.impactCategory,
          p.criticalityScore,
          resolvedFinancial.financialImpactPerHour ?? '',
          p.validationStatus,
        ].join(',');
      })
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bia-export.csv"');
    return res.send(header + rows);
  } catch (error) {
    appLogger.error('Error exporting BIA CSV:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/json — Export BIA as JSON ──────────
router.get('/export/json', requireFeature('api-export'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [report, profile, overrides, graph] = await Promise.all([
      prisma.bIAReport2.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { processes: { orderBy: { recoveryTier: 'asc' } } },
      }),
      resolveCompanyFinancialProfile(prisma, tenantId),
      prisma.nodeFinancialOverride.findMany({
        where: { tenantId },
        select: {
          nodeId: true,
          customCostPerHour: true,
          justification: true,
          validatedBy: true,
          validatedAt: true,
        },
      }),
      GraphService.getGraph(prisma, tenantId),
    ]);
    const overrideByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));
    const downtimeCostByNodeId = buildDowntimeCostMapForProcesses({
      graph,
      processes: (report?.processes || []).map((process) => ({
        serviceNodeId: process.serviceNodeId,
        serviceName: process.serviceName,
        criticalityScore: process.criticalityScore,
        impactCategory: process.impactCategory,
        recoveryTier: process.recoveryTier,
      })),
      profile,
      overrideByNodeId,
    });

    const processes = (report?.processes || []).map((p) => {
      const resolvedFinancial = resolveBiaFinancialForService({
        nodeId: p.serviceNodeId,
        costByNodeId: downtimeCostByNodeId,
      });
      return {
        serviceName: p.serviceName,
        serviceType: p.serviceType,
        tier: p.recoveryTier,
        suggestedRTO: p.suggestedRTO,
        suggestedRPO: p.suggestedRPO,
        suggestedMTPD: p.suggestedMTPD,
        validatedRTO: p.validatedRTO,
        validatedRPO: p.validatedRPO,
        validatedMTPD: p.validatedMTPD,
        impactCategory: p.impactCategory,
        criticalityScore: p.criticalityScore,
        financialImpactPerHour: resolvedFinancial.financialImpactPerHour,
        financialScope: resolvedFinancial.financialScope,
        financialScopeLabel: resolvedFinancial.financialScopeLabel,
        downtimeCostPerHour: resolvedFinancial.downtimeCostPerHour,
        downtimeCostSource: resolvedFinancial.downtimeCostSource,
        downtimeCostSourceLabel: resolvedFinancial.financialScopeLabel,
        downtimeCostRationale: resolvedFinancial.downtimeCostRationale,
        blastRadius: resolvedFinancial.blastRadius,
        validationStatus: p.validationStatus,
      };
    });

    return res.json({ exportedAt: new Date().toISOString(), processes });
  } catch (error) {
    appLogger.error('Error exporting BIA JSON:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/xlsx — Export BIA as XLSX (CSV-compatible TSV) ──────────
router.get('/export/xlsx', requireFeature('api-export'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [report, profile, overrides, graph] = await Promise.all([
      prisma.bIAReport2.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { processes: { orderBy: { recoveryTier: 'asc' } } },
      }),
      resolveCompanyFinancialProfile(prisma, tenantId),
      prisma.nodeFinancialOverride.findMany({
        where: { tenantId },
        select: {
          nodeId: true,
          customCostPerHour: true,
          justification: true,
          validatedBy: true,
          validatedAt: true,
        },
      }),
      GraphService.getGraph(prisma, tenantId),
    ]);
    const overrideByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));
    const downtimeCostByNodeId = buildDowntimeCostMapForProcesses({
      graph,
      processes: (report?.processes || []).map((process) => ({
        serviceNodeId: process.serviceNodeId,
        serviceName: process.serviceName,
        criticalityScore: process.criticalityScore,
        impactCategory: process.impactCategory,
        recoveryTier: process.recoveryTier,
      })),
      profile,
      overrideByNodeId,
    });

    const header = 'Service\tType\tTier\tSuggested RTO\tSuggested RPO\tSuggested MTPD\tValidated RTO\tValidated RPO\tValidated MTPD\tImpact Category\tCriticality Score\tFinancial Impact/h\tStatus\n';
    const rows = (report?.processes || [])
      .map((p) => {
        const resolvedFinancial = resolveBiaFinancialForService({
          nodeId: p.serviceNodeId,
          costByNodeId: downtimeCostByNodeId,
        });
        return [
          p.serviceName,
          p.serviceType,
          p.recoveryTier,
          p.suggestedRTO,
          p.suggestedRPO,
          p.suggestedMTPD,
          p.validatedRTO ?? '',
          p.validatedRPO ?? '',
          p.validatedMTPD ?? '',
          p.impactCategory,
          p.criticalityScore,
          resolvedFinancial.financialImpactPerHour ?? '',
          p.validationStatus,
        ].join('\t');
      })
      .join('\n');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="bia-export.xlsx"');
    return res.send(header + rows);
  } catch (error) {
    appLogger.error('Error exporting BIA XLSX:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/export/pdf — Export BIA as PDF ──────────
router.get('/export/pdf', requireFeature('report-pdf'), async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [report, profile, overrides, graph] = await Promise.all([
      prisma.bIAReport2.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { processes: { orderBy: { recoveryTier: 'asc' } } },
      }),
      resolveCompanyFinancialProfile(prisma, tenantId),
      prisma.nodeFinancialOverride.findMany({
        where: { tenantId },
        select: {
          nodeId: true,
          customCostPerHour: true,
          justification: true,
          validatedBy: true,
          validatedAt: true,
        },
      }),
      GraphService.getGraph(prisma, tenantId),
    ]);
    const overrideByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));
    const downtimeCostByNodeId = buildDowntimeCostMapForProcesses({
      graph,
      processes: (report?.processes || []).map((process) => ({
        serviceNodeId: process.serviceNodeId,
        serviceName: process.serviceName,
        criticalityScore: process.criticalityScore,
        impactCategory: process.impactCategory,
        recoveryTier: process.recoveryTier,
      })),
      profile,
      overrideByNodeId,
    });

    // Build text content for PDF
    const lines = [
      'Business Impact Analysis (BIA) Export',
      `Generated: ${new Date().toISOString()}`,
      '',
      ...((report?.processes || []).map((p) => {
        const resolvedFinancial = resolveBiaFinancialForService({
          nodeId: p.serviceNodeId,
          costByNodeId: downtimeCostByNodeId,
        });
        const impact =
          resolvedFinancial.financialImpactPerHour != null
            ? `${resolvedFinancial.financialImpactPerHour} EUR/h (${resolvedFinancial.financialScopeLabel})`
            : 'Non estime - configurez le profil financier';
        return `[Tier ${p.recoveryTier}] ${p.serviceName} (${p.serviceType}) - RTO: ${p.validatedRTO ?? p.suggestedRTO}min, RPO: ${p.validatedRPO ?? p.suggestedRPO}min - Impact: ${impact} - ${p.validationStatus}`;
      })),
    ];

    const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const margin = 40;
    const fontSize = 10;
    const lineHeight = fontSize * 1.5;
    const pageSize = { width: 595.28, height: 841.89 };

    let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    let y = page.getHeight() - margin;

    for (const line of lines) {
      if (y <= margin) {
        page = pdfDoc.addPage([pageSize.width, pageSize.height]);
        y = page.getHeight() - margin;
      }
      page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="bia-export.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (error) {
    appLogger.error('Error exporting BIA PDF:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/report — Latest BIA report ──────────
router.get('/report', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: { orderBy: { criticalityScore: 'desc' } } },
    });

    if (!report) {
      return res.json({ report: null, message: 'No BIA has been generated yet' });
    }

    return res.json(report);
  } catch (error) {
    appLogger.error('Error fetching BIA report:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PATCH /bia-resilience/processes/:processId — Validate/adjust process ──────────
router.patch('/processes/:processId', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const processId = req.params.processId as string;
    const { validatedRTO, validatedRPO, validatedMTPD, notes, validationStatus } = req.body;

    const existingProcess = await prisma.bIAProcess2.findFirst({
      where: { id: processId, tenantId },
      select: { id: true, serviceNodeId: true, recoveryTier: true },
    });

    if (!existingProcess) {
      return res.status(404).json({ error: 'BIA process not found' });
    }

    const boundedValidated = capRtoRpoByTier(existingProcess.recoveryTier, {
      rtoMinutes:
        validatedRTO === undefined || validatedRTO === null || validatedRTO === ''
          ? null
          : Number(validatedRTO),
      rpoMinutes:
        validatedRPO === undefined || validatedRPO === null || validatedRPO === ''
          ? null
          : Number(validatedRPO),
    });

    const processUpdateData: Record<string, unknown> = {
      validationStatus: validationStatus || 'validated',
    };
    if (validatedRTO !== undefined) {
      processUpdateData.validatedRTO = boundedValidated.rtoMinutes;
    }
    if (validatedRPO !== undefined) {
      processUpdateData.validatedRPO = boundedValidated.rpoMinutes;
    }
    if (validatedMTPD !== undefined) {
      processUpdateData.validatedMTPD = validatedMTPD;
    }
    if (notes !== undefined) {
      processUpdateData.notes = notes;
    }

    const process = await prisma.bIAProcess2.update({
      where: { id: existingProcess.id },
      data: processUpdateData as any,
    });

    // Also update the infra node
    if (validatedRTO !== undefined || validatedRPO !== undefined || validatedMTPD !== undefined) {
      const nodeUpdateData: Record<string, unknown> = {};
      if (validatedRTO !== undefined) {
        nodeUpdateData.validatedRTO = boundedValidated.rtoMinutes;
      }
      if (validatedRPO !== undefined) {
        nodeUpdateData.validatedRPO = boundedValidated.rpoMinutes;
      }
      if (validatedMTPD !== undefined) {
        nodeUpdateData.validatedMTPD = validatedMTPD;
      }

      await prisma.infraNode.updateMany({
        where: { id: existingProcess.serviceNodeId, tenantId },
        data: nodeUpdateData as any,
      });
    }

    return res.json(process);
  } catch (error) {
    appLogger.error('Error updating BIA process:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /bia-resilience/validate-all — Validate all processes at once ──────────
type ValidateAllOverrideInput = {
  processId: string;
  validatedRTO?: unknown;
  validatedRPO?: unknown;
  validatedMTPD?: unknown;
  notes?: unknown;
};

function resolveValidatedValue(value: unknown, fallback: number | null | undefined): number | null {
  if (value === undefined) return fallback ?? null;
  if (value === null || value === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid validated metric value: ${String(value)}`);
  }
  return Math.round(parsed);
}

router.post('/validate-all', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const requestBody = (req.body ?? {}) as { overrides?: unknown };
    if (requestBody.overrides !== undefined && !Array.isArray(requestBody.overrides)) {
      return res.status(400).json({ error: 'Invalid payload: overrides must be an array' });
    }
    const overrides = (requestBody.overrides ?? []) as ValidateAllOverrideInput[];

    // Get latest report
    const report = await prisma.bIAReport2.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { processes: true },
    });

    if (!report) {
      return res.status(400).json({ error: 'No BIA report to validate' });
    }

    // Apply overrides if provided
    const overrideMap = new Map(
      overrides
        .filter((o) => typeof o?.processId === 'string' && o.processId.trim().length > 0)
        .map((o) => [o.processId, o])
    );

    const results = await prisma.$transaction(
      report.processes.map((process) => {
        const override = overrideMap.get(process.id);
        const validatedRtoRaw = resolveValidatedValue(override?.validatedRTO, process.suggestedRTO);
        const validatedRpoRaw = resolveValidatedValue(override?.validatedRPO, process.suggestedRPO);
        const bounded = capRtoRpoByTier(process.recoveryTier, {
          rtoMinutes: validatedRtoRaw,
          rpoMinutes: validatedRpoRaw,
        });
        const updateData: {
          validationStatus: string;
          validatedRTO: number | null;
          validatedRPO: number | null;
          validatedMTPD: number | null;
          notes?: string | null;
        } = {
          validationStatus: 'validated',
          validatedRTO: bounded.rtoMinutes,
          validatedRPO: bounded.rpoMinutes,
          validatedMTPD: resolveValidatedValue(override?.validatedMTPD, process.suggestedMTPD),
        };

        if (override?.notes !== undefined) {
          updateData.notes = override.notes === null ? null : String(override.notes);
        }

        return prisma.bIAProcess2.updateMany({
          where: { id: process.id, tenantId },
          data: updateData,
        });
      })
    );

    const validated = results.reduce((sum, result) => sum + result.count, 0);

    return res.json({ validated });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    appLogger.error('Error validating BIA:', err.message, err.stack);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /bia-resilience/matrix — BIA matrix by tier ──────────
router.get('/matrix', async (req: TenantRequest, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return res.status(500).json({ error: 'Tenant not resolved' });

    const [report, profile, overrides, graph] = await Promise.all([
      prisma.bIAReport2.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { processes: { orderBy: { recoveryTier: 'asc' } } },
      }),
      resolveCompanyFinancialProfile(prisma, tenantId),
      prisma.nodeFinancialOverride.findMany({
        where: { tenantId },
        select: {
          nodeId: true,
          customCostPerHour: true,
          justification: true,
          validatedBy: true,
          validatedAt: true,
        },
      }),
      GraphService.getGraph(prisma, tenantId),
    ]);

    if (!report) {
      return res.json({ tiers: [], message: 'No BIA report generated yet' });
    }
    const overrideByNodeId = new Map(overrides.map((entry) => [entry.nodeId, entry]));
    const downtimeCostByNodeId = buildDowntimeCostMapForProcesses({
      graph,
      processes: report.processes.map((process) => ({
        serviceNodeId: process.serviceNodeId,
        serviceName: process.serviceName,
        criticalityScore: process.criticalityScore,
        impactCategory: process.impactCategory,
        recoveryTier: process.recoveryTier,
      })),
      profile,
      overrideByNodeId,
    });

    const tierNames: Record<number, string> = {
      1: 'Mission Critical',
      2: 'Business Critical',
      3: 'Important',
      4: 'Non-Critical',
    };

    const tiers = [1, 2, 3, 4].map(tier => {
      const procs = report.processes.filter(p => p.recoveryTier === tier);
      return {
        tier,
        name: tierNames[tier],
        processes: procs,
        totalImpact: procs.reduce((sum, process) => {
          const resolvedFinancial = resolveBiaFinancialForService({
            nodeId: process.serviceNodeId,
            costByNodeId: downtimeCostByNodeId,
          });
          return sum + (resolvedFinancial.financialImpactPerHour || 0);
        }, 0),
      };
    });

    return res.json({ tiers });
  } catch (error) {
    appLogger.error('Error fetching BIA matrix:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
