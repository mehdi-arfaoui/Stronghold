import { describe, expect, it } from 'vitest';

import { generateBuiltInScenarios } from '../built-in-scenarios.js';
import type { GraphAnalysisReport } from '../../types/analysis.js';
import type { Service } from '../../services/service-types.js';
import type { InfraNodeAttrs } from '../../types/infrastructure.js';

type ResourceRoleSpec = NonNullable<Service['resources'][number]['role']>;
type ResourceSpec = readonly [string, ResourceRoleSpec];

describe('generateBuiltInScenarios', () => {
  it('generates an AZ failure scenario for each unique AZ', () => {
    const result = generateBuiltInScenarios({
      nodes: [
        createNode('api-a', 'VM', 'eu-west-3', 'eu-west-3a'),
        createNode('api-b', 'VM', 'eu-west-3', 'eu-west-3b'),
      ],
      services: [],
      analysis: createAnalysis(),
    });

    expect(result.scenarios.filter((scenario) => scenario.type === 'az_failure')).toHaveLength(2);
  });

  it('keeps only the top 10 SPOF scenarios in the default set', () => {
    const spofs = Array.from({ length: 12 }, (_, index) => ({
      nodeId: `spof-${index + 1}`,
      nodeName: `spof-${index + 1}`,
      nodeType: 'DATABASE',
      severity: 'high' as const,
      blastRadius: 12 - index,
      impactedServices: [`service-${index + 1}`],
      recommendation: 'Fix it.',
    }));

    const result = generateBuiltInScenarios({
      nodes: spofs.map((spof) => createNode(spof.nodeId, 'DATABASE', 'eu-west-3', 'eu-west-3a')),
      services: [],
      analysis: createAnalysis({ spofs }),
    });

    const defaultScenarios = result.scenarios.filter((scenario) =>
      result.defaultScenarioIds.includes(scenario.id),
    );
    expect(defaultScenarios.filter((scenario) => scenario.type === 'node_failure')).toHaveLength(10);
  });

  it('generates one data corruption scenario per service with datastores', () => {
    const nodes = [
      createNode('payment-db', 'DATABASE', 'eu-west-3', 'eu-west-3a'),
      createNode('assets-bucket', 'OBJECT_STORAGE', 'eu-west-3', 'eu-west-3a'),
    ];
    const services = [
      createService('payment', 'Payment', [['payment-db', 'datastore']]),
      createService('assets', 'Assets', [['assets-bucket', 'storage']]),
    ];

    const result = generateBuiltInScenarios({
      nodes,
      services,
      analysis: createAnalysis(),
    });

    expect(result.scenarios.filter((scenario) => scenario.type === 'data_corruption')).toEqual([
      expect.objectContaining({ id: 'data-corruption-payment' }),
    ]);
  });

  it('generates region failure only for multi-region scans', () => {
    const singleRegion = generateBuiltInScenarios({
      nodes: [createNode('api-a', 'VM', 'eu-west-3', 'eu-west-3a')],
      services: [],
      analysis: createAnalysis(),
    });
    const multiRegion = generateBuiltInScenarios({
      nodes: [
        createNode('api-fr', 'VM', 'eu-west-3', 'eu-west-3a'),
        createNode('api-ie', 'VM', 'eu-west-1', 'eu-west-1a'),
      ],
      services: [],
      analysis: createAnalysis(),
    });

    expect(singleRegion.scenarios.some((scenario) => scenario.type === 'region_failure')).toBe(false);
    expect(multiRegion.scenarios.some((scenario) => scenario.type === 'region_failure')).toBe(true);
  });

  it('caps the default scenario list at 20', () => {
    const nodes = Array.from({ length: 30 }, (_, index) =>
      createNode(`db-${index + 1}`, 'DATABASE', 'eu-west-3', index % 2 === 0 ? 'eu-west-3a' : 'eu-west-3b'),
    );
    const services = nodes.map((node, index) =>
      createService(`service-${index + 1}`, `Service ${index + 1}`, [[node.id, 'datastore']]),
    );
    const spofs = nodes.map((node, index) => ({
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      severity: 'high' as const,
      blastRadius: 40 - index,
      impactedServices: [`service-${index + 1}`],
      recommendation: 'Fix it.',
    }));

    const result = generateBuiltInScenarios({
      nodes,
      services,
      analysis: createAnalysis({ spofs }),
    });

    expect(result.defaultScenarioIds.length).toBeLessThanOrEqual(20);
  });

  it('returns no scenarios for an empty scan', () => {
    const result = generateBuiltInScenarios({
      nodes: [],
      services: [],
      analysis: createAnalysis(),
    });

    expect(result).toEqual({
      scenarios: [],
      defaultScenarioIds: [],
    });
  });
});

function createNode(
  id: string,
  type: string,
  region: string,
  availabilityZone: string,
): InfraNodeAttrs {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region,
    availabilityZone,
    tags: {},
    metadata: {},
  };
}

function createService(
  id: string,
  name: string,
  resources: ReadonlyArray<ResourceSpec>,
): Service {
  return {
    id,
    name,
    criticality: 'high',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: resources.map(([nodeId, role]) => ({
      nodeId,
      role,
      detectionSource: {
        type: 'manual',
        file: '.stronghold/services.yml',
        confidence: 1.0,
      },
    })),
    metadata: {},
  };
}

function createAnalysis(
  overrides: Partial<GraphAnalysisReport> = {},
): GraphAnalysisReport {
  return {
    timestamp: new Date('2026-04-08T00:00:00.000Z'),
    totalNodes: 0,
    totalEdges: 0,
    spofs: [],
    criticalityScores: new Map(),
    redundancyIssues: [],
    regionalRisks: [],
    circularDeps: [],
    cascadeChains: [],
    resilienceScore: 0,
    ...overrides,
  };
}
