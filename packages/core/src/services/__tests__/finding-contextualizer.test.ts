import { describe, expect, it } from 'vitest';

import type { Recommendation } from '../../recommendations/recommendation-types.js';
import type { InfraNode, WeightedValidationResult } from '../../validation/index.js';
import { contextualizeFindings, populateScenarioImpact } from '../finding-contextualizer.js';
import { resolveImpactTemplate } from '../impact-templates.js';
import type { Service } from '../service-types.js';
import type { Scenario } from '../../scenarios/scenario-types.js';

describe('contextualizeFindings', () => {
  it('produces all four dimensions for a datastore finding in a service', () => {
    const finding = createFinding('backup_configured', 'db-1', 'high', 'backup', {
      retentionDays: 0,
    });
    const recommendation = createRecommendation('db-1', 'backup_configured');
    const contextual = contextualizeFindings(
      [finding],
      [createNode('db-1', 'DATABASE', 'rds', { backupRetentionPeriod: 0 })],
      [createService('payment', 'Payment', 'db-1', 'datastore')],
      [recommendation],
    )[0];

    expect(contextual?.serviceId).toBe('payment');
    expect(contextual?.technicalImpact.metadataValue).toBe(0);
    expect(contextual?.drImpact.summary).toContain('No backup configured');
    expect(contextual?.scenarioImpact).toBeNull();
    expect(contextual?.remediation?.estimatedScoreDelta).toBe(recommendation.impact.scoreDelta);
  });

  it('keeps service information null for unassigned resources', () => {
    const contextual = contextualizeFindings(
      [createFinding('backup_configured', 'db-1', 'high', 'backup')],
      [createNode('db-1', 'DATABASE', 'rds')],
      [],
    )[0];

    expect(contextual?.serviceId).toBeNull();
    expect(contextual?.serviceName).toBeNull();
  });

  it('varies DR impact text by resource role', () => {
    const findings = contextualizeFindings(
      [
        createFinding('backup_configured', 'db-1', 'high', 'backup'),
        createFinding('backup_configured', 'bucket-1', 'high', 'backup'),
      ],
      [
        createNode('db-1', 'DATABASE', 'rds'),
        createNode('bucket-1', 'OBJECT_STORAGE', 's3'),
      ],
      [
        createService('payment', 'Payment', 'db-1', 'datastore'),
        createService('assets', 'Assets', 'bucket-1', 'storage'),
      ],
    );

    expect(findings[0]?.drImpact.summary).not.toBe(findings[1]?.drImpact.summary);
  });

  it('links remediation when a recommendation targets the same node and rule', () => {
    const contextual = contextualizeFindings(
      [createFinding('backup_configured', 'db-1', 'high', 'backup')],
      [createNode('db-1', 'DATABASE', 'rds')],
      [],
      [createRecommendation('db-1', 'backup_configured')],
    )[0];

    expect(contextual?.remediation?.actions[0]?.command).toContain('aws rds');
  });

  it('uses specific templates for the layer-1 rule and role matrix', () => {
    const ruleIds = [
      'backup_configured',
      'multi_az',
      'replication_configured',
      'failover_dns',
      'monitoring_configured',
      'encryption_at_rest',
      'point_in_time_recovery',
      'auto_scaling',
      'health_check',
      'dead_letter_queue',
    ] as const;
    const roles = ['datastore', 'compute', 'storage'] as const;

    for (const ruleId of ruleIds) {
      for (const role of roles) {
        const template = resolveImpactTemplate(ruleId, role, ruleId, 'recovery');
        expect(template.summary).not.toContain('does not meet the');
      }
    }
  });

  it('falls back to a generic per-rule template when the role is outside layer 1', () => {
    const template = resolveImpactTemplate('route53_ttl_appropriate', 'dns', 'Route53 TTL', 'failover');

    expect(template.summary).toContain('Failover DNS routing');
  });

  it('falls back to the catch-all template for an unknown rule', () => {
    const contextual = contextualizeFindings(
      [createFinding('unknown_rule', 'db-1', 'medium', 'recovery')],
      [createNode('db-1', 'DATABASE', 'rds')],
      [],
    )[0];

    expect(contextual?.drImpact.summary).toContain('Unknown Rule');
  });

  it('populates affected scenarios for findings on impacted nodes', () => {
    const findings = contextualizeFindings(
      [createFinding('backup_configured', 'db-1', 'high', 'backup')],
      [createNode('db-1', 'DATABASE', 'rds')],
      [createService('payment', 'Payment', 'db-1', 'datastore')],
    );

    const enriched = populateScenarioImpact(findings, [
      createScenario('payment-spof', 'node_failure', 'payment', ['db-1'], ['api-1']),
    ]);

    expect(enriched[0]?.scenarioImpact).toEqual({
      affectedScenarios: ['payment-spof'],
      worstCaseOutcome: 'If this SPOF fails, 1 dependent resource also fails.',
    });
  });

  it('keeps scenarioImpact null for isolated nodes', () => {
    const findings = contextualizeFindings(
      [createFinding('backup_configured', 'db-1', 'high', 'backup')],
      [createNode('db-1', 'DATABASE', 'rds')],
      [createService('payment', 'Payment', 'db-1', 'datastore')],
    );

    const enriched = populateScenarioImpact(findings, []);

    expect(enriched[0]?.scenarioImpact).toBeNull();
  });

  it('picks the worst-case outcome when multiple scenarios affect the same finding', () => {
    const findings = contextualizeFindings(
      [createFinding('backup_configured', 'db-1', 'high', 'backup')],
      [createNode('db-1', 'DATABASE', 'rds')],
      [createService('payment', 'Payment', 'db-1', 'datastore')],
    );

    const enriched = populateScenarioImpact(findings, [
      createScenario('az-failure', 'az_failure', 'payment', ['db-1'], []),
      createScenario('data-corruption', 'data_corruption', 'payment', ['db-1'], []),
    ]);

    expect(enriched[0]?.scenarioImpact?.worstCaseOutcome).toContain('If data is corrupted');
  });
});

function createService(
  id: string,
  name: string,
  nodeId: string,
  role: Service['resources'][number]['role'],
): Service {
  return {
    id,
    name,
    criticality: 'medium',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: [
      {
        nodeId,
        role,
        detectionSource: {
          type: 'manual',
          file: '.stronghold/services.yml',
          confidence: 1.0,
        },
      },
    ],
    metadata: {},
  };
}

function createNode(
  id: string,
  type: string,
  sourceType: string,
  metadata: Record<string, unknown> = {},
): InfraNode {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-1',
    availabilityZone: null,
    tags: {},
    metadata: {
      sourceType,
      ...metadata,
    },
  };
}

function createFinding(
  ruleId: string,
  nodeId: string,
  severity: WeightedValidationResult['severity'],
  category: WeightedValidationResult['category'],
  details?: Record<string, unknown>,
): WeightedValidationResult {
  return {
    ruleId,
    nodeId,
    nodeName: nodeId,
    nodeType: 'test',
    status: 'fail',
    severity,
    category,
    weight: 10,
    message: `${ruleId} failed`,
    ...(details ? { details } : {}),
    weightBreakdown: {
      severityWeight: 1,
      criticalityWeight: 1,
      blastRadiusWeight: 1,
      directDependentCount: 0,
    },
  };
}

function createRecommendation(nodeId: string, ruleId: string): Recommendation {
  return {
    id: `${ruleId}:${nodeId}`,
    title: 'Enable automated backups',
    description: 'Create a recoverable copy.',
    category: 'backup',
    severity: 'high',
    targetNode: nodeId,
    targetNodeName: nodeId,
    impact: {
      scoreDelta: 18,
      affectedRules: [ruleId],
    },
    risk: 'safe',
    riskReason: 'safe',
    remediation: {
      command: 'aws rds modify-db-instance --backup-retention-period 7',
      requiresDowntime: false,
      requiresMaintenanceWindow: false,
      estimatedDuration: '1-2 minutes',
      prerequisites: ['Have change approval.'],
    },
  };
}

function createScenario(
  id: string,
  type: Scenario['type'],
  serviceId: string,
  directlyAffected: readonly string[],
  cascadeAffected: readonly string[],
): Scenario {
  return {
    id,
    name: id,
    description: id,
    type,
    disruption: {
      affectedNodes: directlyAffected,
      selectionCriteria: id,
    },
    impact: {
      directlyAffected: directlyAffected.map((nodeId) => ({
        nodeId,
        nodeName: nodeId,
        serviceId,
        reason: 'direct',
        impactType: 'direct',
        cascadeDepth: 0,
      })),
      cascadeAffected: cascadeAffected.map((nodeId) => ({
        nodeId,
        nodeName: nodeId,
        serviceId,
        reason: 'cascade',
        impactType: 'cascade',
        cascadeDepth: 1,
      })),
      totalAffectedNodes: directlyAffected.length + cascadeAffected.length,
      totalAffectedServices: [serviceId],
      serviceImpact: [
        {
          serviceId,
          serviceName: serviceId,
          affectedResources: directlyAffected.length + cascadeAffected.length,
          totalResources: directlyAffected.length + cascadeAffected.length,
          percentageAffected: 100,
          criticalResourcesAffected: directlyAffected,
          status: 'down',
        },
      ],
    },
  };
}
