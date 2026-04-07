import { describe, expect, it } from 'vitest';

import type { DriftReport } from '../../drift/drift-types.js';
import { NodeType, type InfraNodeAttrs } from '../../types/index.js';
import { analyzeDrpImpact } from '../drift-impact.js';
import type { DRPComponent, DRPlan, RTOEstimate } from '../drp-types.js';

const FIXED_TIMESTAMP = new Date('2026-04-01T08:00:00.000Z');
const RDS_MULTI_AZ_URL =
  'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html';

function makeNode(
  overrides: Partial<InfraNodeAttrs> & Pick<InfraNodeAttrs, 'id' | 'name' | 'type'>,
): InfraNodeAttrs {
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

function makeEstimate(
  overrides: Partial<RTOEstimate> = {},
): RTOEstimate {
  return {
    rtoMinMinutes: 1,
    rtoMaxMinutes: 5,
    rpoMinMinutes: 0,
    rpoMaxMinutes: 0,
    confidence: 'documented',
    method: 'Documented failover',
    factors: [
      {
        name: 'recovery_strategy',
        value: 'multi_az_failover',
        impact: 'Standby capacity is already provisioned.',
        source: { type: 'aws_documentation', url: RDS_MULTI_AZ_URL },
      },
    ],
    limitations: [],
    ...overrides,
  };
}

function makeComponent(
  overrides: Partial<DRPComponent> & Pick<DRPComponent, 'resourceId' | 'name' | 'resourceType'>,
): DRPComponent {
  return {
    resourceId: overrides.resourceId,
    resourceType: overrides.resourceType,
    name: overrides.name,
    region: 'eu-west-1',
    recoveryStrategy: 'failover',
    recoverySteps: [],
    estimatedRTO: '5m',
    estimatedRPO: '0m',
    dependencies: [],
    risks: [],
    rtoEstimate: makeEstimate(),
    ...overrides,
  };
}

function makePlan(components: readonly DRPComponent[]): DRPlan {
  return {
    id: 'drp-test',
    version: '1.0.0',
    generated: FIXED_TIMESTAMP.toISOString(),
    infrastructureHash: 'hash',
    provider: 'aws',
    regions: ['eu-west-1'],
    services: [
      {
        name: 'database-recovery',
        criticality: 'critical',
        rtoTarget: '15m',
        rpoTarget: '5m',
        components,
        validationTests: [],
        estimatedRTO: '5m',
        estimatedRPO: '0m',
        recoveryOrder: components.map((component) => component.resourceId),
      },
    ],
    metadata: {
      totalResources: components.length,
      coveredResources: components.length,
      uncoveredResources: [],
      worstCaseRTO: '5m',
      averageRPO: '0m',
      stale: false,
    },
  };
}

function makeReport(changes: DriftReport['changes']): DriftReport {
  return {
    scanIdBefore: 'before',
    scanIdAfter: 'after',
    timestamp: FIXED_TIMESTAMP,
    changes,
    summary: {
      total: changes.length,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      byCategory: {
        backup_changed: 0,
        redundancy_changed: 0,
        network_changed: 0,
        security_changed: 0,
        resource_added: 0,
        resource_removed: 0,
        config_changed: 0,
        dependency_changed: 0,
      },
      drpStale: false,
    },
  };
}

describe('analyzeDrpImpact', () => {
  it('produces an impact when a drifted resource is referenced by the DRP', () => {
    const component = makeComponent({
      resourceId: 'db',
      name: 'main-database',
      resourceType: NodeType.DATABASE,
    });
    const report = analyzeDrpImpact(
      makeReport([
        {
          id: 'replica_removed:db:replicaCount',
          category: 'redundancy_changed',
          severity: 'high',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'replicaCount',
          previousValue: 2,
          currentValue: 1,
          description: 'Replica capacity decreased for main-database.',
          drImpact: 'Read scale and failover headroom are reduced.',
          affectedServices: [],
        },
      ]),
      {
        drpPlan: makePlan([component]),
        baselineNodes: [makeNode({ id: 'db', name: 'main-database', type: NodeType.DATABASE })],
        currentNodes: [makeNode({ id: 'db', name: 'main-database', type: NodeType.DATABASE })],
      },
    );

    expect(report.status).toBe('stale');
    expect(report.impacts[0]?.drpSections).toEqual(['database-recovery']);
    expect(report.impacts[0]?.impact).toBe('degraded');
  });

  it('returns informational impact when the drifted resource is not referenced by the DRP', () => {
    const report = analyzeDrpImpact(
      makeReport([
        {
          id: 'scaling_changed:cache:scaling',
          category: 'config_changed',
          severity: 'medium',
          resourceId: 'cache',
          resourceType: NodeType.CACHE,
          field: 'scaling',
          previousValue: { min: 1, max: 2 },
          currentValue: { min: 1, max: 4 },
          description: 'Scaling bounds changed for cache.',
          drImpact: 'Recovery capacity assumptions may no longer match the runtime footprint.',
          affectedServices: [],
        },
      ]),
      {
        drpPlan: makePlan([
          makeComponent({
            resourceId: 'db',
            name: 'main-database',
            resourceType: NodeType.DATABASE,
          }),
        ]),
      },
    );

    expect(report.status).toBe('current');
    expect(report.impacts[0]?.impact).toBe('informational');
    expect(report.impacts[0]?.drpSections).toEqual([]);
  });

  it('marks Multi-AZ removal as degraded and includes a documented RTO change', () => {
    const component = makeComponent({
      resourceId: 'db',
      name: 'main-database',
      resourceType: NodeType.DATABASE,
    });
    const baseline = makeNode({
      id: 'db',
      name: 'main-database',
      type: NodeType.DATABASE,
      metadata: { sourceType: 'rds_instance', multiAZ: true, backupRetentionPeriod: 7 },
    });
    const current = makeNode({
      id: 'db',
      name: 'main-database',
      type: NodeType.DATABASE,
      metadata: { sourceType: 'rds_instance', multiAZ: false, backupRetentionPeriod: 7 },
    });

    const report = analyzeDrpImpact(
      makeReport([
        {
          id: 'multi_az_disabled:db:multi_az',
          category: 'redundancy_changed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'multi_az',
          previousValue: true,
          currentValue: false,
          description: 'Multi-AZ redundancy was disabled for main-database.',
          drImpact: 'A zonal failure can now interrupt recovery and increase failover time.',
          affectedServices: [],
        },
      ]),
      {
        drpPlan: makePlan([component]),
        baselineNodes: [baseline],
        currentNodes: [current],
      },
    );

    expect(report.impacts[0]?.impact).toBe('degraded');
    expect(report.impacts[0]?.estimatedRtoChange?.before).toBe('1 minute-5 minutes');
    expect(report.impacts[0]?.estimatedRtoChange?.after).toBe('less than 24 hours');
    expect(report.impacts[0]?.estimatedRtoChange?.source).toContain('docs.aws.amazon.com');
  });

  it('marks backup removal as invalidated', () => {
    const component = makeComponent({
      resourceId: 'db',
      name: 'main-database',
      resourceType: NodeType.DATABASE,
      recoveryStrategy: 'restore_from_backup',
    });
    const report = analyzeDrpImpact(
      makeReport([
        {
          id: 'backup_disabled:db:backup',
          category: 'backup_changed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'backup',
          previousValue: true,
          currentValue: false,
          description: 'Backup protection was disabled for main-database.',
          drImpact: 'Restore points may be missing or older than the DR objectives require.',
          affectedServices: [],
        },
      ]),
      {
        drpPlan: makePlan([component]),
        baselineNodes: [makeNode({ id: 'db', name: 'main-database', type: NodeType.DATABASE })],
      },
    );

    expect(report.impacts[0]?.impact).toBe('invalidated');
  });

  it('returns no impacts when no drift exists', () => {
    const report = analyzeDrpImpact(makeReport([]), {
      drpPlan: makePlan([
        makeComponent({
          resourceId: 'db',
          name: 'main-database',
          resourceType: NodeType.DATABASE,
        }),
      ]),
    });

    expect(report.impacts).toEqual([]);
    expect(report.status).toBe('current');
  });

  it("returns a helpful message when no DRP exists", () => {
    const report = analyzeDrpImpact(
      makeReport([
        {
          id: 'resource_removed:db:resource',
          category: 'resource_removed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'resource',
          previousValue: 'main-database',
          currentValue: null,
          description: 'Resource removed from the snapshot: main-database.',
          drImpact: 'The DR plan may reference a component that no longer exists.',
          affectedServices: [],
        },
      ]),
    );

    expect(report.status).toBe('missing_drp');
    expect(report.message).toBe("No DRP found. Run 'stronghold plan generate' first.");
  });

  it('does not invent a before RTO when the original DRP estimate was unverified', () => {
    const component = makeComponent({
      resourceId: 'db',
      name: 'main-database',
      resourceType: NodeType.DATABASE,
      recoveryStrategy: 'restore_from_backup',
      rtoEstimate: makeEstimate({
        rtoMinMinutes: null,
        rtoMaxMinutes: null,
        confidence: 'unverified',
        factors: [],
      }),
    });
    const report = analyzeDrpImpact(
      makeReport([
        {
          id: 'backup_disabled:db:backup',
          category: 'backup_changed',
          severity: 'critical',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'backup',
          previousValue: true,
          currentValue: false,
          description: 'Backup protection was disabled for main-database.',
          drImpact: 'Restore points may be missing or older than the DR objectives require.',
          affectedServices: [],
        },
      ]),
      {
        drpPlan: makePlan([component]),
      },
    );

    expect(report.impacts[0]?.estimatedRtoChange?.before).toBeNull();
  });

  it('marks after-RTO as unverified when no documented source exists', () => {
    const component = makeComponent({
      resourceId: 'db',
      name: 'main-database',
      resourceType: NodeType.DATABASE,
      rtoEstimate: makeEstimate({
        rtoMinMinutes: 5,
        rtoMaxMinutes: 30,
        confidence: 'informed',
      }),
    });
    const current = makeNode({
      id: 'db',
      name: 'main-database',
      type: NodeType.DATABASE,
      metadata: { sourceType: 'rds_instance', backupRetentionPeriod: 7 },
    });

    const report = analyzeDrpImpact(
      makeReport([
        {
          id: 'replica_removed:db:replicaCount',
          category: 'redundancy_changed',
          severity: 'high',
          resourceId: 'db',
          resourceType: NodeType.DATABASE,
          field: 'replicaCount',
          previousValue: 1,
          currentValue: 0,
          description: 'Replica capacity decreased for main-database.',
          drImpact: 'Read scale and failover headroom are reduced.',
          affectedServices: [],
        },
      ]),
      {
        drpPlan: makePlan([component]),
        currentNodes: [current],
      },
    );

    expect(report.impacts[0]?.estimatedRtoChange?.after).toBeNull();
    expect(report.impacts[0]?.estimatedRtoChange?.confidence).toBe('unverified');
  });
});
