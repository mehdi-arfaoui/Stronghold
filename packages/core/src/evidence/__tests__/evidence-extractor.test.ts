import { describe, expect, it } from 'vitest';

import { extractEvidence } from '../evidence-extractor.js';
import type { InfraNode, ValidationResult, ValidationRule } from '../../validation/index.js';
import { runValidation } from '../../validation/index.js';

function createNode(metadata: Record<string, unknown> = {}): InfraNode {
  return {
    id: 'payment-db',
    name: 'payment-db',
    type: 'RDS',
    provider: 'aws',
    region: 'eu-west-3',
    tags: {},
    metadata: {
      sourceType: 'rds',
      ...metadata,
    },
  };
}

function createRule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  return {
    id: 'custom_rule',
    name: 'Custom Rule',
    description: 'Custom Rule',
    category: 'backup',
    severity: 'high',
    appliesToTypes: ['rds'],
    validate: (node) => ({
      ruleId: 'custom_rule',
      nodeId: node.id,
      status: 'fail',
      message: 'Custom rule failed.',
    }),
    ...overrides,
  };
}

describe('extractEvidence', () => {
  it('produces observed evidence from declared observedKeys', () => {
    const node = createNode({
      backupRetentionPeriod: 7,
    });
    const rule = createRule({
      observedKeys: ['backupRetentionPeriod'],
    });
    const result: ValidationResult = {
      ruleId: rule.id,
      nodeId: node.id,
      status: 'pass',
      message: 'Automated backups retained for 7 day(s).',
    };

    const evidence = extractEvidence(rule, node, result, '2026-04-08T10:32:00.000Z');

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.type).toBe('observed');
    expect(evidence[0]?.observation.key).toBe('backupRetentionPeriod');
    expect(evidence[0]?.observation.value).toBe(7);
    expect(evidence[0]?.timestamp).toBe('2026-04-08T10:32:00.000Z');
  });

  it('falls back to rule mapping when observedKeys are absent', () => {
    const node = createNode();
    const rule = createRule({
      id: 'backup_plan_exists',
      name: 'AWS Backup Plan Coverage',
      validate: (candidate) => ({
        ruleId: 'backup_plan_exists',
        nodeId: candidate.id,
        status: 'fail',
        message: 'No AWS Backup plan covers this resource.',
      }),
    });

    const evidence = extractEvidence(
      rule,
      node,
      rule.validate(node, { allNodes: [node], edges: [] }),
      '2026-04-08T10:32:00.000Z',
    );

    expect(evidence[0]?.observation.key).toBe('backupPlanId');
    expect(evidence[0]?.observation.value).toBeNull();
    expect(evidence[0]?.type).toBe('inferred');
  });

  it('marks graph-derived evidence as inferred', () => {
    const node = createNode();
    const rule = createRule({
      id: 'cloudwatch_alarm_exists',
      name: 'CloudWatch Alarm Coverage',
      category: 'detection',
      validate: (candidate) => ({
        ruleId: 'cloudwatch_alarm_exists',
        nodeId: candidate.id,
        status: 'pass',
        message: '1 CloudWatch alarm(s) monitor this resource.',
        details: {
          alarmCount: 1,
        },
      }),
    });

    const evidence = extractEvidence(
      rule,
      node,
      rule.validate(node, { allNodes: [node], edges: [] }),
      '2026-04-08T10:32:00.000Z',
    );

    expect(evidence[0]?.type).toBe('inferred');
    expect(evidence[0]?.observation.value).toBe(1);
  });

  it('creates one evidence entry per observed key and preserves missing values as null', () => {
    const node = createNode({
      backupRetentionPeriod: 0,
    });
    const rule = createRule({
      observedKeys: ['backupRetentionPeriod', 'backupRetentionDays'],
    });
    const result: ValidationResult = {
      ruleId: rule.id,
      nodeId: node.id,
      status: 'fail',
      message: 'Automated backups are not configured.',
    };

    const evidence = extractEvidence(rule, node, result, '2026-04-08T10:32:00.000Z');

    expect(evidence).toHaveLength(2);
    expect(evidence[0]?.observation.value).toBe(0);
    expect(evidence[1]?.observation.value).toBeNull();
  });

  it('attaches extracted evidence to validation results', () => {
    const rule = createRule({
      observedKeys: ['backupRetentionPeriod'],
      validate: (node) => ({
        ruleId: 'custom_rule',
        nodeId: node.id,
        status: 'pass',
        message: 'Automated backups retained for 7 day(s).',
      }),
    });

    const report = runValidation(
      [createNode({ backupRetentionPeriod: 7 })],
      [],
      [rule],
      undefined,
      { timestamp: '2026-04-08T10:32:00.000Z' },
    );

    expect(report.results[0]?.evidence).toHaveLength(1);
    expect(report.results[0]?.evidence[0]?.observation.key).toBe('backupRetentionPeriod');
    expect(report.results[0]?.evidence[0]?.timestamp).toBe('2026-04-08T10:32:00.000Z');
  });
});
