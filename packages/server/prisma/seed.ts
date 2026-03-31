import { PrismaClient } from '@prisma/client';
import { getStartupDemoPipelineInput, validateDRPlan } from '@stronghold-dr/core';

import { PrismaScanRepository } from '../src/adapters/prisma-scan-repository.js';
import { runScanPipeline } from '../src/services/scan-pipeline.js';

const prisma = new PrismaClient();

const SEEDED_SCAN_ID = '11111111-1111-4111-8111-111111111111';

async function main(): Promise<void> {
  const timestamp = new Date();
  const demo = getStartupDemoPipelineInput();
  const scanRepository = new PrismaScanRepository(prisma);

  const artifacts = await runScanPipeline({
    provider: demo.provider,
    regions: demo.regions,
    nodes: demo.nodes,
    edges: demo.edges,
    timestamp,
  });
  const drPlanValidation = validateDRPlan(artifacts.drPlan, artifacts.graph);

  await prisma.$transaction([
    prisma.scan.deleteMany({
      where: { id: SEEDED_SCAN_ID },
    }),
    prisma.scan.create({
      data: {
        id: SEEDED_SCAN_ID,
        provider: demo.provider,
        regions: [...demo.regions],
        status: 'PENDING',
        createdAt: timestamp,
      },
    }),
  ]);

  await scanRepository.saveCompletedScan({
    scanId: SEEDED_SCAN_ID,
    provider: demo.provider,
    regions: demo.regions,
    timestamp,
    nodes: artifacts.nodes,
    edges: artifacts.edges,
    analysis: artifacts.serializedAnalysis,
    validationReport: artifacts.validationReport,
    drPlan: artifacts.drPlan,
    drPlanValidation,
  });

  const summary = artifacts.validationReport;
  const topFailures = summary.criticalFailures
    .slice(0, 3)
    .map((failure) => `${failure.nodeName}: ${failure.message}`);

  console.log(
    [
      `Seeded demo scan ${SEEDED_SCAN_ID}`,
      `Score ${Math.round(summary.scoreBreakdown.overall)} (${summary.scoreBreakdown.grade})`,
      `Categories ${JSON.stringify(summary.scoreBreakdown.byCategory)}`,
      `Top failures ${topFailures.length > 0 ? topFailures.join(' | ') : 'none'}`,
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error('Prisma seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
