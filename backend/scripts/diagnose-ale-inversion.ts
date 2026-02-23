import prisma from '../src/prismaClient.ts';
import { DR_STRATEGY_PROFILES } from '../src/constants/dr-financial-reference-data.ts';
import { buildLandingZoneFinancialContext } from '../src/services/landing-zone-financial.service.ts';

type DiagnosticRow = {
  service: string;
  criticity: number | null;
  currentRtoMinutes: number;
  targetRtoMinutes: number;
  currentRpoMinutes: number | null;
  targetRpoMinutes: number | null;
  hourlyDowntimeCost: number;
  probabilityAnnual: number;
  aleBefore: number;
  aleAfter: number;
  delta: number;
  aberrant: boolean;
  strategy: string;
  currentRtoSource: string;
  targetRtoSource: string;
  currentRpoSource: string;
  targetRpoSource: string;
  strategyRtoMin: number | null;
  strategyRtoMax: number | null;
  strategyRtoTypical: number | null;
};

function normalizeStrategyKey(strategy: string | null | undefined): string {
  return String(strategy || '').toLowerCase().replace(/[-\s]/g, '_');
}

function detectShopMaxTenantId(): Promise<string | null> {
  return prisma.infraNode
    .findFirst({
      where: { id: 'route53-shopmax' },
      select: { tenantId: true },
    })
    .then((node) => node?.tenantId ?? null);
}

async function resolveTenantId(): Promise<string> {
  const explicit = process.argv[2];
  if (explicit && explicit.trim().length > 0) return explicit.trim();

  const detected = await detectShopMaxTenantId();
  if (!detected) {
    throw new Error(
      'ShopMax tenant not found. Pass tenantId explicitly: npx tsx scripts/diagnose-ale-inversion.ts <tenantId>',
    );
  }
  return detected;
}

function printTable(rows: DiagnosticRow[]): void {
  const header = [
    'Service',
    'Criticite',
    'RTO_actuel(min)',
    'RTO_apres(min)',
    'RPO_actuel(min)',
    'RPO_apres(min)',
    'hourlyDowntimeCost',
    'probabilite',
    'ALE_avant',
    'ALE_apres',
    'Delta(apres-avant)',
    'Aberrant?',
  ];

  console.log(header.join(' | '));
  for (const row of rows) {
    console.log(
      [
        row.service,
        row.criticity ?? 'n/a',
        row.currentRtoMinutes,
        row.targetRtoMinutes,
        row.currentRpoMinutes ?? 'n/a',
        row.targetRpoMinutes ?? 'n/a',
        row.hourlyDowntimeCost,
        row.probabilityAnnual,
        row.aleBefore,
        row.aleAfter,
        row.delta,
        row.aberrant ? 'YES' : 'NO',
      ].join(' | '),
    );
  }
}

function printAberrantTrace(rows: DiagnosticRow[]): void {
  const aberrantRows = rows.filter((row) => row.aberrant);
  console.log(`\nCas aberrants (ALE_apres > ALE_avant): ${aberrantRows.length}`);
  if (aberrantRows.length === 0) return;

  console.log('\n=== TRACE DES CAS ABERRANTS ===');
  for (const row of aberrantRows) {
    console.log(`\n- Service: ${row.service}`);
    console.log(`  Strategie: ${row.strategy}`);
    console.log(
      `  RTO_actuel: ${row.currentRtoMinutes} min (source: ${row.currentRtoSource})`,
    );
    console.log(
      `  RTO_apres: ${row.targetRtoMinutes} min (source: ${row.targetRtoSource}; range min=${row.strategyRtoMin}, max=${row.strategyRtoMax}, typical=${row.strategyRtoTypical})`,
    );
    console.log(
      `  RPO_actuel: ${row.currentRpoMinutes ?? 'n/a'} min (source: ${row.currentRpoSource})`,
    );
    console.log(
      `  RPO_apres: ${row.targetRpoMinutes ?? 'n/a'} min (source: ${row.targetRpoSource})`,
    );
    console.log(`  hourlyDowntimeCost (identique avant/apres): ${row.hourlyDowntimeCost}`);
    console.log(`  probabiliteIncident (identique avant/apres): ${row.probabilityAnnual}`);
    console.log(`  ALE_avant=${row.aleBefore}, ALE_apres=${row.aleAfter}, delta=${row.delta}`);
  }
}

async function main() {
  const tenantId = await resolveTenantId();
  const context = await buildLandingZoneFinancialContext(prisma, tenantId);

  const latestBia = await prisma.bIAReport2.findFirst({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
    include: {
      processes: {
        where: { validationStatus: 'validated' },
        select: {
          serviceNodeId: true,
          validatedRTO: true,
          validatedRPO: true,
          recoveryTier: true,
        },
      },
    },
  });
  const processByService = new Map(
    (latestBia?.processes || []).map((process) => [process.serviceNodeId, process]),
  );

  const nodeIds = context.recommendations.map((recommendation) => recommendation.nodeId);
  const nodes = nodeIds.length
    ? await prisma.infraNode.findMany({
        where: { tenantId, id: { in: nodeIds } },
        select: {
          id: true,
          validatedRTO: true,
          suggestedRTO: true,
          validatedRPO: true,
          suggestedRPO: true,
          criticalityScore: true,
        },
      })
    : [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const rows: DiagnosticRow[] = context.recommendations.map((recommendation) => {
    const process = processByService.get(recommendation.nodeId);
    const node = nodeById.get(recommendation.nodeId);
    const strategyKey = normalizeStrategyKey(recommendation.strategy);
    const strategyProfile =
      strategyKey in DR_STRATEGY_PROFILES
        ? DR_STRATEGY_PROFILES[strategyKey as keyof typeof DR_STRATEGY_PROFILES]
        : null;

    const currentRtoSource =
      process?.validatedRTO != null
        ? 'BIA.process.validatedRTO'
        : node?.validatedRTO != null
          ? 'InfraNode.validatedRTO'
          : node?.suggestedRTO != null
            ? 'InfraNode.suggestedRTO'
            : 'fallback_financial_engine';

    const currentRpoSource =
      process?.validatedRPO != null
        ? 'BIA.process.validatedRPO'
        : node?.validatedRPO != null
          ? 'InfraNode.validatedRPO'
          : node?.suggestedRPO != null
            ? 'InfraNode.suggestedRPO'
            : 'fallback_financial_engine';

    const aleBefore = recommendation.calculation?.aleCurrent ?? 0;
    const aleAfter = recommendation.calculation?.aleAfter ?? 0;

    return {
      service: recommendation.serviceName || recommendation.id,
      criticity: recommendation.tier ?? process?.recoveryTier ?? null,
      currentRtoMinutes: (recommendation.calculation?.inputs?.currentRtoHours ?? 0) * 60,
      targetRtoMinutes: (recommendation.calculation?.inputs?.targetRtoHours ?? 0) * 60,
      currentRpoMinutes:
        process?.validatedRPO ?? node?.validatedRPO ?? node?.suggestedRPO ?? null,
      targetRpoMinutes: strategyProfile?.rpoMaxMinutes ?? null,
      hourlyDowntimeCost: recommendation.calculation?.inputs?.hourlyDowntimeCost ?? 0,
      probabilityAnnual: recommendation.calculation?.inputs?.incidentProbabilityAnnual ?? 0,
      aleBefore,
      aleAfter,
      delta: Number((aleAfter - aleBefore).toFixed(2)),
      aberrant: aleAfter > aleBefore,
      strategy: recommendation.strategy || 'unknown',
      currentRtoSource,
      targetRtoSource:
        'Recommendation.calculation.inputs.targetRtoHours (derive de strategyTargetRtoMinutes)',
      currentRpoSource,
      targetRpoSource:
        'Recommendation strategy profile -> DR_STRATEGY_PROFILES[strategy].rpoMaxMinutes',
      strategyRtoMin: strategyProfile?.rtoMinMinutes ?? null,
      strategyRtoMax: strategyProfile?.rtoMaxMinutes ?? null,
      strategyRtoTypical: strategyProfile?.rtoTypicalMinutes ?? null,
    };
  });

  console.log(`Tenant: ${tenantId}`);
  console.log('\n=== TABLEAU DIAGNOSTIC ALE ===');
  printTable(rows);
  console.log(`\nTotal recommandations: ${rows.length}`);
  printAberrantTrace(rows);
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Diagnostic failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
