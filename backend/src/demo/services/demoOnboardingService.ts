import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import * as GraphService from '../../graph/graphService.js';
import { runSimulation } from '../../graph/simulationEngine.js';
import { RunbookGeneratorService } from '../../services/runbook-generator.service.js';
import {
  DEMO_INCIDENT_SEEDS,
  DEMO_PRA_EXERCISE_KEY,
  DEMO_RUNBOOK_KEY,
  DEMO_SERVICE_SEEDS,
  DEMO_SIMULATION_SEEDS,
} from './demoOnboardingDataset.js';
import { runDemoSeed, type RunDemoSeedOptions } from './demoSeedService.js';
import { appLogger } from '../../utils/logger.js';

const PERFORMANCE_BUDGET_MS = 10_000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

type DemoSeedGuardMode = 'development' | 'test' | 'demo' | 'restricted' | 'production';

type DemoPipelineStep = {
  step: string;
  status: 'completed' | 'failed';
  durationMs: number;
  details?: string;
};

type DemoServiceSeedSummary = {
  servicesSeeded: number;
  serviceIdsByKey: Record<string, string>;
};

type DemoIncidentSeedSummary = {
  incidentsSeeded: number;
};

type DemoPreparednessSummary = {
  simulationsSeeded: number;
  runbooksSeeded: number;
  praExercisesSeeded: number;
};

export type DemoSeedGuardResult = {
  allowed: boolean;
  nodeEnv: string;
  mode: DemoSeedGuardMode;
  reason: string;
};

export type DemoOnboardingSummary = Awaited<ReturnType<typeof runDemoSeed>> & {
  servicesSeeded: number;
  incidentsSeeded: number;
  simulationsSeeded: number;
  runbooksSeeded: number;
  praExercisesSeeded: number;
  durationMs: number;
  performanceBudgetMs: number;
  withinPerformanceBudget: boolean;
  pipeline: DemoPipelineStep[];
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toStoredJson(value: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}

function requireServiceId(
  serviceIdsByKey: Record<string, string>,
  serviceKey: string,
  incidentKey: string,
): string {
  const serviceId = serviceIdsByKey[serviceKey];
  if (!serviceId) {
    throw new Error(`Missing seeded service mapping for incident ${incidentKey}: ${serviceKey}`);
  }
  return serviceId;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter((entry) => entry.length > 0)));
}

function buildScopedDemoId(tenantId: string, key: string): string {
  const digest = createHash('sha256').update(`${tenantId}:${key}`).digest('hex').slice(0, 12);
  return `demo-${key}-${digest}`;
}

function pickFirstAvailableNodeId(graph: GraphService.GraphInstance, candidateIds: string[]): string | null {
  for (const nodeId of candidateIds) {
    if (graph.hasNode(nodeId)) return nodeId;
  }
  return null;
}

function pickAvailableNodeIds(
  graph: GraphService.GraphInstance,
  candidateIds: string[],
  maxItems: number,
): string[] {
  const selected: string[] = [];
  for (const nodeId of dedupe(candidateIds)) {
    if (!graph.hasNode(nodeId)) continue;
    selected.push(nodeId);
    if (selected.length >= maxItems) break;
  }
  return selected;
}

export function getDemoSeedGuard(env: NodeJS.ProcessEnv = process.env): DemoSeedGuardResult {
  const nodeEnv = String(env.NODE_ENV || 'development').toLowerCase();
  if (nodeEnv === 'production') {
    return {
      allowed: false,
      nodeEnv,
      mode: 'production',
      reason: 'Demo onboarding is disabled in production.',
    };
  }

  if (nodeEnv === 'development') {
    return {
      allowed: true,
      nodeEnv,
      mode: 'development',
      reason: 'Development environment allows demo onboarding.',
    };
  }

  if (nodeEnv === 'test') {
    return {
      allowed: true,
      nodeEnv,
      mode: 'test',
      reason: 'Test environment allows demo onboarding.',
    };
  }

  const allowDemoSeed = String(env.ALLOW_DEMO_SEED || '').toLowerCase() === 'true';
  const appEnv = String(env.APP_ENV || env.DEPLOYMENT_STAGE || '').toLowerCase();
  const isDemoContext = appEnv.includes('demo');

  if (allowDemoSeed || isDemoContext) {
    return {
      allowed: true,
      nodeEnv,
      mode: 'demo',
      reason: 'Explicit demo context allows demo onboarding.',
    };
  }

  return {
    allowed: false,
    nodeEnv,
    mode: 'restricted',
    reason:
      'Demo onboarding is limited to development/test or explicit demo contexts (ALLOW_DEMO_SEED=true or APP_ENV=demo).',
  };
}

async function seedDemoServices(
  prisma: PrismaClient,
  tenantId: string,
): Promise<DemoServiceSeedSummary> {
  const requiredNodeIds = dedupe(DEMO_SERVICE_SEEDS.map((seed) => seed.linkedNodeId));
  const existingNodes = await prisma.infraNode.findMany({
    where: {
      tenantId,
      id: { in: requiredNodeIds },
    },
    select: { id: true },
  });

  const existingNodeIds = new Set(existingNodes.map((node) => node.id));
  const missingNodeIds = requiredNodeIds.filter((nodeId) => !existingNodeIds.has(nodeId));
  if (missingNodeIds.length > 0) {
    throw new Error(`Missing infra nodes for demo service catalog: ${missingNodeIds.join(', ')}`);
  }

  const serviceIdsByKey: Record<string, string> = {};

  for (const serviceSeed of DEMO_SERVICE_SEEDS) {
    const serviceId = buildScopedDemoId(tenantId, `service-${serviceSeed.key}`);
    serviceIdsByKey[serviceSeed.key] = serviceId;
    const existingService = await prisma.service.findFirst({
      where: {
        tenantId,
        id: serviceId,
      },
      select: { id: true },
    });

    const serviceData = {
      name: serviceSeed.name,
      type: serviceSeed.type,
      description: serviceSeed.description || null,
      owner: serviceSeed.owner,
      criticality: serviceSeed.criticality,
      businessPriority: serviceSeed.businessPriority || null,
      domain: 'APP' as const,
    };

    if (existingService) {
      await prisma.service.updateMany({
        where: {
          tenantId,
          id: serviceId,
        },
        data: serviceData,
      });
      continue;
    }

    await prisma.service.create({
      data: {
        id: serviceId,
        tenantId,
        ...serviceData,
      },
    });
  }

  return {
    servicesSeeded: DEMO_SERVICE_SEEDS.length,
    serviceIdsByKey,
  };
}

async function seedDemoIncidents(
  prisma: PrismaClient,
  tenantId: string,
  serviceIdsByKey: Record<string, string>,
): Promise<DemoIncidentSeedSummary> {
  const requiredNodeIds = dedupe(DEMO_INCIDENT_SEEDS.flatMap((seed) => seed.affectedNodeIds));
  const existingNodes = await prisma.infraNode.findMany({
    where: {
      tenantId,
      id: { in: requiredNodeIds },
    },
    select: { id: true },
  });

  const existingNodeIds = new Set(existingNodes.map((node) => node.id));
  const missingNodeIds = requiredNodeIds.filter((nodeId) => !existingNodeIds.has(nodeId));
  if (missingNodeIds.length > 0) {
    throw new Error(`Missing infra nodes for demo incidents: ${missingNodeIds.join(', ')}`);
  }

  const incidentIds = DEMO_INCIDENT_SEEDS.map((seed) =>
    buildScopedDemoId(tenantId, `incident-${seed.key}`),
  );

  await prisma.incidentAction.deleteMany({
    where: {
      tenantId,
      incidentId: { in: incidentIds },
    },
  });
  await prisma.incidentService.deleteMany({
    where: {
      tenantId,
      incidentId: { in: incidentIds },
    },
  });
  await prisma.incidentDocument.deleteMany({
    where: {
      tenantId,
      incidentId: { in: incidentIds },
    },
  });
  await prisma.incident.deleteMany({
    where: {
      tenantId,
      id: { in: incidentIds },
    },
  });

  for (const incidentSeed of DEMO_INCIDENT_SEEDS) {
    const incidentId = buildScopedDemoId(tenantId, `incident-${incidentSeed.key}`);
    const detectedAt = new Date(Date.now() - incidentSeed.detectedHoursAgo * HOUR_MS);

    await prisma.incident.create({
      data: {
        id: incidentId,
        tenantId,
        title: incidentSeed.title,
        description: incidentSeed.description,
        status: incidentSeed.status,
        detectedAt,
        responsibleTeam: incidentSeed.responsibleTeam,
        services: {
          create: incidentSeed.serviceKeys.map((serviceKey) => ({
            tenantId,
            serviceId: requireServiceId(serviceIdsByKey, serviceKey, incidentSeed.key),
          })),
        },
        actions: {
          create: incidentSeed.actions.map((actionSeed) => ({
            tenantId,
            actionType: actionSeed.actionType,
            description: actionSeed.description,
            metadata: toJson({
              source: 'demo.onboarding',
              affectedNodeIds: incidentSeed.affectedNodeIds,
            }),
            createdAt: new Date(Date.now() - actionSeed.minutesAgo * MINUTE_MS),
          })),
        },
      },
    });
  }

  return {
    incidentsSeeded: DEMO_INCIDENT_SEEDS.length,
  };
}

async function seedDemoPreparednessArtifacts(
  prisma: PrismaClient,
  tenantId: string,
): Promise<DemoPreparednessSummary> {
  const graph = await GraphService.loadGraphFromDB(prisma, tenantId);
  if (graph.order === 0) {
    throw new Error('Cannot generate preparedness artifacts because graph is empty.');
  }

  const topBiaNodes = await prisma.bIAProcess2.findMany({
    where: { tenantId },
    orderBy: [{ recoveryTier: 'asc' }, { criticalityScore: 'desc' }],
    take: 5,
    select: { serviceNodeId: true },
  });

  const topBiaNodeIds = dedupe(topBiaNodes.map((entry) => entry.serviceNodeId));

  const simulationRecords: Array<{
    id: string;
    name: string;
    scenarioType: string;
    scenarioParams: Record<string, unknown>;
    result: ReturnType<typeof runSimulation>;
    createdAt: Date;
  }> = [];

  for (const simulationSeed of DEMO_SIMULATION_SEEDS) {
    const simulationId = buildScopedDemoId(tenantId, `simulation-${simulationSeed.key}`);
    let scenarioParams: Record<string, unknown> = {};

    if (simulationSeed.scenarioType === 'custom') {
      const selectedNodes = pickAvailableNodeIds(
        graph,
        [...topBiaNodeIds, ...simulationSeed.fallbackNodeIds],
        4,
      );
      if (selectedNodes.length === 0) {
        throw new Error(`Unable to resolve impacted nodes for simulation ${simulationSeed.key}`);
      }
      scenarioParams = { nodes: selectedNodes };
    }

    if (simulationSeed.scenarioType === 'third_party_outage') {
      const targetNode = pickFirstAvailableNodeId(graph, [
        ...simulationSeed.fallbackNodeIds,
        ...topBiaNodeIds,
      ]);
      if (!targetNode) {
        throw new Error(`Unable to resolve third-party target for simulation ${simulationSeed.key}`);
      }
      scenarioParams = { service: targetNode };
    }

    if (simulationSeed.scenarioType === 'region_loss') {
      const region = 'eu-west-1';
      scenarioParams = { region };
    }

    const simulationResult = runSimulation(graph, {
      scenarioType: simulationSeed.scenarioType,
      params: scenarioParams,
      name: simulationSeed.name,
    });

    const persistedAt = new Date();

    const existingSimulation = await prisma.simulation.findFirst({
      where: {
        tenantId,
        id: simulationId,
      },
      select: { id: true },
    });

    const simulationData = {
      name: simulationSeed.name,
      scenarioType: simulationSeed.scenarioType,
      scenarioParams: toJson(scenarioParams),
      result: toJson(simulationResult),
      totalNodesAffected: simulationResult.metrics.totalNodesAffected,
      percentageAffected: simulationResult.metrics.percentageInfraAffected,
      estimatedDowntime: simulationResult.metrics.estimatedDowntimeMinutes,
      estimatedFinancialLoss: simulationResult.metrics.estimatedFinancialLoss,
      postIncidentScore: simulationResult.postIncidentResilienceScore,
    };

    if (existingSimulation) {
      await prisma.simulation.updateMany({
        where: {
          tenantId,
          id: simulationId,
        },
        data: simulationData,
      });
    } else {
      await prisma.simulation.create({
        data: {
          id: simulationId,
          tenantId,
          createdAt: persistedAt,
          ...simulationData,
        },
      });
    }

    simulationRecords.push({
      id: simulationId,
      name: simulationSeed.name,
      scenarioType: simulationSeed.scenarioType,
      scenarioParams,
      result: simulationResult,
      createdAt: persistedAt,
    });
  }

  const primarySimulation = simulationRecords[0];
  if (!primarySimulation) {
    throw new Error('No simulation generated during demo preparedness seeding.');
  }

  const impactedNodeIds = dedupe(
    RunbookGeneratorService.extractImpactedNodeIds(primarySimulation.result),
  );

  const impactedNodes = await prisma.infraNode.findMany({
    where: {
      tenantId,
      id: { in: impactedNodeIds },
    },
    select: {
      id: true,
      name: true,
      type: true,
      provider: true,
      region: true,
      availabilityZone: true,
      metadata: true,
    },
  });

  const generatedRunbook = RunbookGeneratorService.generateFromSimulation({
    simulation: {
      id: primarySimulation.id,
      name: primarySimulation.name,
      scenarioType: primarySimulation.scenarioType,
      scenarioParams: primarySimulation.scenarioParams as any,
      result: toStoredJson(primarySimulation.result),
      createdAt: primarySimulation.createdAt,
    },
    impactedNodes,
  });

  const runbookId = buildScopedDemoId(tenantId, `runbook-${DEMO_RUNBOOK_KEY}`);
  const lastTestedAt = new Date(Date.now() - 2 * DAY_MS);

  const existingRunbook = await prisma.runbook.findFirst({
    where: {
      tenantId,
      id: runbookId,
    },
    select: { id: true },
  });

  const runbookData = {
    simulationId: primarySimulation.id,
    title: generatedRunbook.title,
    description: generatedRunbook.description,
    status: 'active' as const,
    summary: generatedRunbook.description,
    steps: toJson(generatedRunbook.steps),
    responsible: generatedRunbook.responsible,
    accountable: generatedRunbook.accountable,
    consulted: generatedRunbook.consulted,
    informed: generatedRunbook.informed,
    lastTestedAt,
    testResult: 'passed',
    generatedForServices: impactedNodes.map((node) => node.id).join(','),
    templateId: null,
    templateNameSnapshot: null,
  };

  if (existingRunbook) {
    await prisma.runbook.updateMany({
      where: {
        tenantId,
        id: runbookId,
      },
      data: runbookData,
    });
  } else {
    await prisma.runbook.create({
      data: {
        id: runbookId,
        tenantId,
        recommendationId: null,
        generatedAt: new Date(),
        ...runbookData,
      },
    });
  }

  const predictedRTO = generatedRunbook.predictedRTO;
  const predictedRPO = generatedRunbook.predictedRPO;
  const actualRTO = Math.max(predictedRTO + 15, predictedRTO);
  const actualRPO = Math.max(predictedRPO + 10, predictedRPO);
  const scheduledAt = new Date(Date.now() - 3 * DAY_MS);
  const executedAt = new Date(Date.now() - DAY_MS);

  const praExerciseId = buildScopedDemoId(tenantId, `pra-${DEMO_PRA_EXERCISE_KEY}`);

  const existingPraExercise = await prisma.pRAExercise.findFirst({
    where: {
      tenantId,
      id: praExerciseId,
    },
    select: { id: true },
  });

  const praExerciseData = {
    title: 'Quarterly checkout failover exercise',
    description: 'Demo PRA exercise generated after onboarding to compare predicted and actual RTO/RPO.',
    runbookId,
    simulationId: primarySimulation.id,
    scheduledAt,
    executedAt,
    duration: Math.max(actualRTO, 30),
    status: 'completed' as const,
    outcome: 'success' as const,
    actualRTO,
    actualRPO,
    findings: toJson({
      summary: 'Recovery goals met with minor delay on payment database failover.',
      impactedNodeIds,
    }),
    predictedRTO,
    predictedRPO,
    deviationRTO: actualRTO - predictedRTO,
    deviationRPO: actualRPO - predictedRPO,
  };

  if (existingPraExercise) {
    await prisma.pRAExercise.updateMany({
      where: {
        tenantId,
        id: praExerciseId,
      },
      data: praExerciseData,
    });
  } else {
    await prisma.pRAExercise.create({
      data: {
        id: praExerciseId,
        tenantId,
        ...praExerciseData,
      },
    });
  }

  return {
    simulationsSeeded: simulationRecords.length,
    runbooksSeeded: 1,
    praExercisesSeeded: 1,
  };
}

export async function runDemoOnboarding(
  prisma: PrismaClient,
  tenantId: string,
  options: RunDemoSeedOptions = {},
): Promise<DemoOnboardingSummary> {
  const pipeline: DemoPipelineStep[] = [];
  const startedAt = Date.now();

  const runStep = async <T>(step: string, callback: () => Promise<T>): Promise<T> => {
    const stepStartedAt = Date.now();
    try {
      const result = await callback();
      pipeline.push({
        step,
        status: 'completed',
        durationMs: Date.now() - stepStartedAt,
      });
      return result;
    } catch (error) {
      const details = error instanceof Error ? error.message : 'unknown_error';
      pipeline.push({
        step,
        status: 'failed',
        durationMs: Date.now() - stepStartedAt,
        details,
      });
      throw error;
    }
  };

  const baseSeedSummary = await runStep('seed_infra_and_analysis', async () =>
    runDemoSeed(prisma, tenantId, options),
  );
  const serviceSummary = await runStep('seed_service_catalog', async () =>
    seedDemoServices(prisma, tenantId),
  );
  const incidentSummary = await runStep('seed_incidents', async () =>
    seedDemoIncidents(prisma, tenantId, serviceSummary.serviceIdsByKey),
  );
  const preparednessSummary = await runStep('seed_preparedness_artifacts', async () =>
    seedDemoPreparednessArtifacts(prisma, tenantId),
  );

  const durationMs = Date.now() - startedAt;
  const withinPerformanceBudget = durationMs <= PERFORMANCE_BUDGET_MS;

  if (!withinPerformanceBudget) {
    appLogger.warn('demo.onboarding.performance_budget_exceeded', {
      tenantId,
      durationMs,
      performanceBudgetMs: PERFORMANCE_BUDGET_MS,
    });
  }

  return {
    ...baseSeedSummary,
    servicesSeeded: serviceSummary.servicesSeeded,
    incidentsSeeded: incidentSummary.incidentsSeeded,
    simulationsSeeded: preparednessSummary.simulationsSeeded,
    runbooksSeeded: preparednessSummary.runbooksSeeded,
    praExercisesSeeded: preparednessSummary.praExercisesSeeded,
    durationMs,
    performanceBudgetMs: PERFORMANCE_BUDGET_MS,
    withinPerformanceBudget,
    pipeline,
  };
}
