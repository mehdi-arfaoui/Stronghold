import type { PrismaClient } from '@prisma/client';

import * as GraphService from '../graph/graphService.js';
import { analyzeFullGraph } from '../graph/graphAnalysisEngine.js';
import { generateBIA } from '../graph/biaEngine.js';
import { validateRTORPOConsistency } from '../bia/services/bia-suggestion.service.js';

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

export async function generateAndPersistBiaReport(
  prisma: PrismaClient,
  tenantId: string,
) {
  const graph = await GraphService.getGraph(prisma, tenantId);

  if (graph.order === 0) {
    return null;
  }

  const analysis = await analyzeFullGraph(graph);
  const biaReport = generateBIA(graph, analysis);
  const consistentProcesses = biaReport.processes.map((process) => {
    const bounded = capRtoRpoByTier(process.recoveryTier, {
      rtoMinutes: process.suggestedRTO,
      rpoMinutes: process.suggestedRPO,
    });
    return {
      ...process,
      suggestedRTO: bounded.rtoMinutes ?? process.suggestedRTO,
      suggestedRPO: bounded.rpoMinutes ?? process.suggestedRPO,
    };
  });

  const dbReport = await prisma.bIAReport2.create({
    data: {
      generatedAt: biaReport.generatedAt,
      summary: biaReport.summary as any,
      tenantId,
      processes: {
        create: consistentProcesses.map((process) => ({
          serviceNodeId: process.serviceNodeId,
          serviceName: process.serviceName,
          serviceType: process.serviceType,
          suggestedMAO: process.suggestedMAO,
          suggestedMTPD: process.suggestedMTPD,
          suggestedRTO: process.suggestedRTO,
          suggestedRPO: process.suggestedRPO,
          suggestedMBCO: process.suggestedMBCO,
          impactCategory: process.impactCategory,
          criticalityScore: process.criticalityScore,
          recoveryTier: process.recoveryTier,
          dependencyChain: process.dependencyChain as any,
          weakPoints: process.weakPoints as any,
          financialImpact: process.financialImpact as any,
          validationStatus: 'pending',
          tenantId,
        })),
      },
    },
    include: { processes: true },
  });

  for (const process of consistentProcesses) {
    await prisma.infraNode.updateMany({
      where: { id: process.serviceNodeId, tenantId },
      data: {
        suggestedRTO: process.suggestedRTO,
        suggestedRPO: process.suggestedRPO,
        suggestedMTPD: process.suggestedMTPD,
        impactCategory: process.impactCategory,
        financialImpactPerHour: null,
      },
    });
  }

  return dbReport;
}
