import { describe, expect, it } from 'vitest';
import { NodeType, type InfraNodeAttrs } from '../types/index.js';
import { detectDrift } from './drift-detector.js';

const FIXED_TIMESTAMP = new Date('2026-03-26T00:00:00.000Z');

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

function runDriftDetection(
  before: readonly InfraNodeAttrs[],
  after: readonly InfraNodeAttrs[],
) {
  return detectDrift(before, after, {
    scanIdBefore: 'scan-before',
    scanIdAfter: 'scan-after',
    timestamp: FIXED_TIMESTAMP,
  });
}

describe('detectDrift', () => {
  it('should detect resource removal as critical drift', () => {
    const before = [
      makeNode({ id: 'app', name: 'orders-api', type: NodeType.APPLICATION }),
      makeNode({ id: 'db', name: 'orders-db', type: NodeType.DATABASE }),
      makeNode({ id: 'cache', name: 'orders-cache', type: NodeType.CACHE }),
    ];
    const after = before.slice(0, 2);

    const report = runDriftDetection(before, after);

    expect(report.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'resource_removed',
          severity: 'critical',
          resourceId: 'cache',
        }),
      ]),
    );
  });

  it('should detect resource addition as info drift', () => {
    const before = [
      makeNode({ id: 'app', name: 'orders-api', type: NodeType.APPLICATION }),
      makeNode({ id: 'db', name: 'orders-db', type: NodeType.DATABASE }),
    ];
    const after = [
      ...before,
      makeNode({ id: 'queue', name: 'orders-queue', type: NodeType.MESSAGE_QUEUE }),
    ];

    const report = runDriftDetection(before, after);

    expect(report.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'resource_added',
          severity: 'info',
          resourceId: 'queue',
        }),
      ]),
    );
  });

  it('should detect backup disabled as critical', () => {
    const before = [
      makeNode({
        id: 'rds-primary',
        name: 'orders-rds',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'aws_rds_instance',
          backup_enabled: true,
        },
      }),
    ];
    const after = [
      makeNode({
        id: 'rds-primary',
        name: 'orders-rds',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'aws_rds_instance',
          backup_enabled: false,
        },
      }),
    ];

    const report = runDriftDetection(before, after);

    expect(report.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'backup_changed',
          severity: 'critical',
          resourceId: 'rds-primary',
        }),
      ]),
    );
  });

  it('should detect multi-AZ disabled as critical', () => {
    const before = [
      makeNode({
        id: 'rds-primary',
        name: 'orders-rds',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'aws_rds_instance',
          multi_az: true,
        },
      }),
    ];
    const after = [
      makeNode({
        id: 'rds-primary',
        name: 'orders-rds',
        type: NodeType.DATABASE,
        metadata: {
          sourceType: 'aws_rds_instance',
          multi_az: false,
        },
      }),
    ];

    const report = runDriftDetection(before, after);

    expect(report.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'redundancy_changed',
          severity: 'critical',
          resourceId: 'rds-primary',
          field: 'multi_az',
        }),
      ]),
    );
  });

  it('should return empty report when nothing changed', () => {
    const before = [
      makeNode({ id: 'app', name: 'orders-api', type: NodeType.APPLICATION }),
      makeNode({ id: 'db', name: 'orders-db', type: NodeType.DATABASE }),
    ];
    const after = [...before];

    const report = runDriftDetection(before, after);

    expect(report.changes.length).toBe(0);
  });

  it('should mark DRP as stale when critical change detected', () => {
    const before = [
      makeNode({ id: 'app', name: 'orders-api', type: NodeType.APPLICATION }),
      makeNode({ id: 'db', name: 'orders-db', type: NodeType.DATABASE }),
      makeNode({ id: 'cache', name: 'orders-cache', type: NodeType.CACHE }),
    ];
    const after = before.slice(0, 2);

    const report = runDriftDetection(before, after);

    expect(report.summary.drpStale).toBe(true);
  });
});
