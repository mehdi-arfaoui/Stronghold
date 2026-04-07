import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NodeType } from '../../types/index.js';
import { allValidationRules } from '../../validation/validation-rules.js';
import { runValidation } from '../../validation/validation-engine.js';
import type {
  InfraNode,
  ValidationReport,
  WeightedValidationResult,
} from '../../validation/validation-types.js';
import {
  generateRecommendations,
  selectTopRecommendations,
} from '../recommendation-engine.js';

function createNode(
  overrides: Partial<InfraNode> & Pick<InfraNode, 'id' | 'name' | 'type'>,
): InfraNode {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    provider: 'aws',
    region: 'eu-west-1',
    tags: {},
    metadata: {},
    ...overrides,
  };
}

function createResult(
  overrides: Partial<WeightedValidationResult> &
    Pick<
      WeightedValidationResult,
      'ruleId' | 'nodeId' | 'nodeName' | 'nodeType' | 'status' | 'severity' | 'category' | 'weight'
    >,
): WeightedValidationResult {
  return {
    ruleId: overrides.ruleId,
    nodeId: overrides.nodeId,
    status: overrides.status,
    message: overrides.message ?? 'message',
    severity: overrides.severity,
    category: overrides.category,
    nodeName: overrides.nodeName,
    nodeType: overrides.nodeType,
    weight: overrides.weight,
    weightBreakdown: overrides.weightBreakdown ?? {
      severityWeight: 1,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
    },
    remediation: overrides.remediation,
    details: overrides.details,
  };
}

function createReport(results: readonly WeightedValidationResult[]): ValidationReport {
  return {
    timestamp: '2026-04-06T00:00:00.000Z',
    totalChecks: results.length,
    passed: 0,
    failed: results.filter((result) => result.status === 'fail').length,
    warnings: results.filter((result) => result.status === 'warn').length,
    skipped: 0,
    errors: 0,
    results,
    score: 42,
    scoreBreakdown: {
      overall: 42,
      byCategory: {
        backup: 42,
        redundancy: 42,
        failover: 42,
        detection: 42,
        recovery: 42,
        replication: 42,
      },
      grade: 'D',
      weakestCategory: 'backup',
      scoringMethod: 'test',
      disclaimer: 'test',
    },
    criticalFailures: [],
    scannedResources: 3,
  };
}

function loadFixtureRecommendations(fixtureName: string) {
  const fixturePath = new URL(`../../__fixtures__/${fixtureName}`, import.meta.url);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    readonly nodes: readonly InfraNode[];
    readonly edges: readonly Array<{ readonly source: string; readonly target: string; readonly type: string }>;
  };
  const report = runValidation(fixture.nodes, fixture.edges, allValidationRules);
  return generateRecommendations({
    nodes: fixture.nodes,
    validationReport: report,
    isDemo: true,
  });
}

describe('generateRecommendations', () => {
  it('generates recommendations from validation findings', () => {
    const nodes = [
      createNode({
        id: 'db-1',
        name: 'main-db',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'RDS',
          dbIdentifier: 'main-db',
        },
      }),
    ];
    const report = createReport([
      createResult({
        ruleId: 'rds_multi_az_active',
        nodeId: 'db-1',
        nodeName: 'main-db',
        nodeType: NodeType.DATABASE,
        status: 'fail',
        severity: 'high',
        category: 'failover',
        weight: 12,
      }),
    ]);

    const recommendations = generateRecommendations({
      nodes,
      validationReport: report,
    });

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.title).toContain('Enable Multi-AZ');
    expect(recommendations[0]?.remediation.command).toContain('modify-db-instance');
  });

  it('sorts by severity, then impact, then risk', () => {
    const nodes = [
      createNode({
        id: 'db-1',
        name: 'main-db',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'RDS',
          dbIdentifier: 'main-db',
        },
      }),
      createNode({
        id: 'bucket-1',
        name: 'assets',
        type: NodeType.OBJECT_STORAGE,
        metadata: {
          sourceType: 'S3_BUCKET',
          bucketName: 'assets',
        },
      }),
      createNode({
        id: 'vpc-1',
        name: 'core-vpc',
        type: NodeType.VPC,
        metadata: {
          sourceType: 'VPC',
          vpcId: 'vpc-1234',
        },
      }),
    ];
    const report = createReport([
      createResult({
        ruleId: 'backup_plan_exists',
        nodeId: 'db-1',
        nodeName: 'main-db',
        nodeType: NodeType.DATABASE,
        status: 'fail',
        severity: 'critical',
        category: 'backup',
        weight: 10,
      }),
      createResult({
        ruleId: 'vpc_multi_az_subnets',
        nodeId: 'vpc-1',
        nodeName: 'core-vpc',
        nodeType: NodeType.VPC,
        status: 'fail',
        severity: 'critical',
        category: 'redundancy',
        weight: 10,
      }),
      createResult({
        ruleId: 's3_versioning_enabled',
        nodeId: 'bucket-1',
        nodeName: 'assets',
        nodeType: NodeType.OBJECT_STORAGE,
        status: 'fail',
        severity: 'high',
        category: 'backup',
        weight: 8,
      }),
    ]);

    const recommendations = generateRecommendations({
      nodes,
      validationReport: report,
    });

    expect(recommendations.map((item) => item.id)).toEqual([
      'backup-plan:db-1',
      'vpc-multi-az:vpc-1',
      's3-versioning:bucket-1',
    ]);
  });

  it('calculates score deltas from weighted contribution and keeps warning deltas smaller', () => {
    const nodes = [
      createNode({
        id: 'db-1',
        name: 'main-db',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'RDS',
          dbIdentifier: 'main-db',
        },
      }),
      createNode({
        id: 'bucket-1',
        name: 'assets',
        type: NodeType.OBJECT_STORAGE,
        metadata: {
          sourceType: 'S3_BUCKET',
          bucketName: 'assets',
        },
      }),
      createNode({
        id: 'lambda-1',
        name: 'image-resizer',
        type: NodeType.SERVERLESS,
        metadata: {
          sourceType: 'LAMBDA',
          functionName: 'image-resizer',
        },
      }),
    ];
    const report = createReport([
      createResult({
        ruleId: 'rds_multi_az_active',
        nodeId: 'db-1',
        nodeName: 'main-db',
        nodeType: NodeType.DATABASE,
        status: 'fail',
        severity: 'high',
        category: 'failover',
        weight: 20,
      }),
      createResult({
        ruleId: 's3_versioning_enabled',
        nodeId: 'bucket-1',
        nodeName: 'assets',
        nodeType: NodeType.OBJECT_STORAGE,
        status: 'warn',
        severity: 'high',
        category: 'backup',
        weight: 10,
      }),
      createResult({
        ruleId: 'cloudwatch_alarm_exists',
        nodeId: 'lambda-1',
        nodeName: 'image-resizer',
        nodeType: NodeType.SERVERLESS,
        status: 'pass',
        severity: 'high',
        category: 'detection',
        weight: 10,
      }),
    ]);

    const recommendations = generateRecommendations({
      nodes,
      validationReport: report,
    });

    expect(recommendations[0]?.impact.scoreDelta).toBe(50);
    expect(recommendations[1]?.impact.scoreDelta).toBe(13);
  });

  it('excludes dangerous recommendations from the top-three scan highlights', () => {
    const nodes = [
      createNode({
        id: 'db-1',
        name: 'main-db',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'RDS',
          dbIdentifier: 'main-db',
        },
      }),
      createNode({
        id: 'bucket-1',
        name: 'assets',
        type: NodeType.OBJECT_STORAGE,
        metadata: {
          sourceType: 'S3_BUCKET',
          bucketName: 'assets',
        },
      }),
      createNode({
        id: 'vpc-1',
        name: 'core-vpc',
        type: NodeType.VPC,
        metadata: {
          sourceType: 'VPC',
          vpcId: 'vpc-1234',
        },
      }),
      createNode({
        id: 'lambda-1',
        name: 'image-resizer',
        type: NodeType.SERVERLESS,
        metadata: {
          sourceType: 'LAMBDA',
          functionName: 'image-resizer',
        },
      }),
    ];
    const report = createReport([
      createResult({
        ruleId: 'vpc_multi_az_subnets',
        nodeId: 'vpc-1',
        nodeName: 'core-vpc',
        nodeType: NodeType.VPC,
        status: 'fail',
        severity: 'critical',
        category: 'redundancy',
        weight: 15,
      }),
      createResult({
        ruleId: 'backup_plan_exists',
        nodeId: 'db-1',
        nodeName: 'main-db',
        nodeType: NodeType.DATABASE,
        status: 'fail',
        severity: 'critical',
        category: 'backup',
        weight: 14,
      }),
      createResult({
        ruleId: 's3_versioning_enabled',
        nodeId: 'bucket-1',
        nodeName: 'assets',
        nodeType: NodeType.OBJECT_STORAGE,
        status: 'fail',
        severity: 'high',
        category: 'backup',
        weight: 13,
      }),
      createResult({
        ruleId: 'cloudwatch_alarm_exists',
        nodeId: 'lambda-1',
        nodeName: 'image-resizer',
        nodeType: NodeType.SERVERLESS,
        status: 'fail',
        severity: 'high',
        category: 'detection',
        weight: 12,
      }),
    ]);

    const recommendations = generateRecommendations({
      nodes,
      validationReport: report,
    });
    const top = selectTopRecommendations(recommendations, 3);

    expect(top).toHaveLength(3);
    expect(top.some((item) => item.risk === 'dangerous')).toBe(false);
  });

  it('produces placeholder commands when redact mode is enabled', () => {
    const nodes = [
      createNode({
        id: 'db-1',
        name: 'main-db',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'RDS',
          dbIdentifier: 'main-db',
        },
      }),
    ];
    const report = createReport([
      createResult({
        ruleId: 'rds_multi_az_active',
        nodeId: 'db-1',
        nodeName: 'main-db',
        nodeType: NodeType.DATABASE,
        status: 'fail',
        severity: 'high',
        category: 'failover',
        weight: 12,
      }),
    ]);

    const recommendations = generateRecommendations({
      nodes,
      validationReport: report,
      redact: true,
    });

    expect(recommendations[0]?.remediation.command).toContain('<your-rds-instance>');
    expect(recommendations[0]?.remediation.command).not.toContain('main-db');
  });

  it('returns no recommendations when there are no actionable findings', () => {
    const recommendations = generateRecommendations({
      nodes: [],
      validationReport: createReport([]),
    });

    expect(recommendations).toEqual([]);
  });

  it('produces recommendations for the built-in demo fixtures without leaking real ARNs', () => {
    const startup = loadFixtureRecommendations('demo-startup.json');
    const enterprise = loadFixtureRecommendations('demo-enterprise.json');
    const minimal = loadFixtureRecommendations('demo-minimal.json');

    expect(startup.length).toBeGreaterThanOrEqual(3);
    expect(enterprise.length).toBeGreaterThan(0);
    expect(minimal.length).toBeGreaterThan(0);
    expect(
      [...startup, ...enterprise, ...minimal].every(
        (item) => !item.remediation.command.includes('arn:aws'),
      ),
    ).toBe(true);
  });
});
