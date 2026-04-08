import fs from 'node:fs';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileAuditLogger } from '../../audit/audit-logger.js';
import type { ContextualFinding } from '../../services/finding-types.js';
import type { ServicePosture } from '../../services/service-posture-types.js';
import type { Service } from '../../services/service-types.js';
import {
  collectGovernanceAuditEvents,
  createRiskAcceptanceAuditEvent,
  logGovernanceAuditEvent,
  type GovernanceAuditedScan,
} from '../governance-audit.js';

describe('collectGovernanceAuditEvents', () => {
  it('collects newly expired acceptances, review-due ownership, and new policy violations', () => {
    const current = createGovernedScan({
      governance: {
        riskAcceptances: [
          {
            id: 'ra-001',
            findingKey: 'backup_plan_exists::payment-db',
            acceptedBy: 'mehdi@example.com',
            justification: 'Approved for staging',
            acceptedAt: '2026-03-01T00:00:00Z',
            expiresAt: '2026-04-01T00:00:00Z',
            severityAtAcceptance: 'high',
            status: 'expired',
          },
        ],
        score: {
          withAcceptances: { score: 70, grade: 'C' },
          withoutAcceptances: { score: 65, grade: 'D' },
          excludedFindings: 0,
        },
        policyViolations: [
          {
            policyId: 'pol-001',
            policyName: 'Critical services must have backup',
            findingKey: 'backup_plan_exists::payment-db',
            nodeId: 'payment-db',
            serviceId: 'payment',
            severity: 'critical',
            message: 'payment-db violates policy "Critical services must have backup".',
          },
        ],
      },
      servicePosture: createPosture({
        governance: {
          owner: 'team-backend',
          ownerStatus: 'review_due',
          confirmedAt: '2026-01-01T00:00:00Z',
          nextReviewAt: '2026-04-01T00:00:00.000Z',
        },
      }),
    });
    const previous = createGovernedScan({
      governance: {
        riskAcceptances: [
          {
            id: 'ra-001',
            findingKey: 'backup_plan_exists::payment-db',
            acceptedBy: 'mehdi@example.com',
            justification: 'Approved for staging',
            acceptedAt: '2026-03-01T00:00:00Z',
            expiresAt: '2026-04-01T00:00:00Z',
            severityAtAcceptance: 'high',
            status: 'active',
          },
        ],
        score: {
          withAcceptances: { score: 75, grade: 'B' },
          withoutAcceptances: { score: 65, grade: 'D' },
          excludedFindings: 1,
        },
        policyViolations: [],
      },
      servicePosture: createPosture({
        governance: {
          owner: 'team-backend',
          ownerStatus: 'unconfirmed',
        },
      }),
    });

    const events = collectGovernanceAuditEvents(current, previous);

    expect(events.map((event) => event.action)).toEqual([
      'risk_expire',
      'ownership_review_due',
      'policy_violation',
    ]);
  });

  it('does not re-log persistent policy violations', () => {
    const violation = {
      policyId: 'pol-001',
      policyName: 'Critical services must have backup',
      findingKey: 'backup_plan_exists::payment-db',
      nodeId: 'payment-db',
      serviceId: 'payment',
      severity: 'critical',
      message: 'payment-db violates policy "Critical services must have backup".',
    } as const;

    const events = collectGovernanceAuditEvents(
      createGovernedScan({
        governance: {
          riskAcceptances: [],
          score: {
            withAcceptances: { score: 70, grade: 'C' },
            withoutAcceptances: { score: 70, grade: 'C' },
            excludedFindings: 0,
          },
          policyViolations: [violation],
        },
      }),
      createGovernedScan({
        governance: {
          riskAcceptances: [],
          score: {
            withAcceptances: { score: 70, grade: 'C' },
            withoutAcceptances: { score: 70, grade: 'C' },
            excludedFindings: 0,
          },
          policyViolations: [violation],
        },
      }),
    );

    expect(events).toEqual([]);
  });
});

describe('logGovernanceAuditEvent', () => {
  it('writes governance audit metadata without infrastructure payloads', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-governance-audit-'));
    const auditPath = path.join(directory, '.stronghold', 'audit.jsonl');
    const logger = new FileAuditLogger(auditPath);

    await logGovernanceAuditEvent(
      logger,
      createRiskAcceptanceAuditEvent({
        id: 'ra-001',
        findingKey: 'backup_plan_exists::payment-db',
        acceptedBy: 'mehdi@example.com',
        justification: 'Approved for staging',
        expiresAt: '2026-09-01T00:00:00Z',
      }),
      {
        timestamp: '2026-04-08T00:00:00.000Z',
      },
    );

    const [line] = (await readFile(auditPath, 'utf8')).trim().split('\n');
    const parsed = JSON.parse(line ?? '') as Record<string, unknown>;

    expect(parsed).toMatchObject({
      action: 'risk_accept',
      parameters: {
        acceptanceId: 'ra-001',
        findingKey: 'backup_plan_exists::payment-db',
        acceptedBy: 'mehdi@example.com',
      },
    });
    expect(parsed).not.toHaveProperty('nodes');
    expect(parsed).not.toHaveProperty('validationReport');
  });
});

function createGovernedScan(
  overrides: Partial<GovernanceAuditedScan> = {},
): GovernanceAuditedScan {
  return {
    timestamp: '2026-04-08T00:00:00.000Z',
    servicePosture: createPosture(),
    governance: {
      riskAcceptances: [],
      score: {
        withAcceptances: { score: 80, grade: 'B' },
        withoutAcceptances: { score: 80, grade: 'B' },
        excludedFindings: 0,
      },
    },
    ...overrides,
  };
}

function createPosture(
  serviceOverrides: Partial<Service> = {},
): Pick<ServicePosture, 'services' | 'contextualFindings'> {
  const service: Service = {
    id: 'payment',
    name: 'Payment',
    criticality: 'critical',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1,
    },
    resources: [
      {
        nodeId: 'payment-db',
        role: 'datastore',
        detectionSource: {
          type: 'manual',
          file: '.stronghold/services.yml',
          confidence: 1,
        },
      },
    ],
    metadata: {},
    ...serviceOverrides,
  };
  const finding: ContextualFinding = {
    ruleId: 'backup_plan_exists',
    nodeId: 'payment-db',
    nodeName: 'payment-db',
    severity: 'high',
    category: 'backup',
    passed: false,
    serviceId: 'payment',
    serviceName: 'Payment',
    resourceRole: 'datastore',
    technicalImpact: {
      observation: 'Missing backup plan',
      metadataKey: 'backupPlan',
      metadataValue: false,
      expectedValue: 'configured',
    },
    drImpact: {
      summary: 'Data recovery is not possible.',
      recoveryImplication: 'Restore requires a backup that does not exist.',
      affectedCapability: 'backup',
    },
    scenarioImpact: null,
    remediation: null,
  };

  return {
    services: [
      {
        service,
        score: {
          serviceId: 'payment',
          serviceName: 'Payment',
          resourceCount: 1,
          criticality: 'critical',
          detectionSource: service.detectionSource,
          score: 34,
          grade: 'D',
          findingsCount: {
            critical: 1,
            high: 0,
            medium: 0,
            low: 0,
          },
          findings: [],
          coverageGaps: [],
        },
        contextualFindings: [finding],
        recommendations: [],
      },
    ],
    contextualFindings: [finding],
  };
}
