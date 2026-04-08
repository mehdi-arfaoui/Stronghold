import { describe, expect, it } from 'vitest';

import { validateRunbookLiveness } from '../runbook-validator.js';
import type { DRPRunbook } from '../../drp/runbook/runbook-types.js';
import type { InfraNodeAttrs } from '../../types/infrastructure.js';

describe('validateRunbookLiveness', () => {
  it('flags deleted component resources', () => {
    const validation = validateRunbookLiveness(createRunbook(), []);

    expect(validation.isAlive).toBe(false);
    expect(validation.staleReferences).toContainEqual(
      expect.objectContaining({
        referencedResourceId: 'payment-db',
        issue: 'resource_deleted',
      }),
    );
  });

  it('flags missing step references', () => {
    const runbook = createRunbook({
      stepCommand: 'aws rds reboot-db-instance --db-instance-identifier replica-db',
    });
    const validation = validateRunbookLiveness(runbook, [createNode('payment-db', 'DATABASE')]);

    expect(validation.isAlive).toBe(false);
    expect(validation.staleReferences).toContainEqual(
      expect.objectContaining({
        referencedResourceId: 'replica-db',
        issue: 'resource_not_found',
      }),
    );
  });

  it('flags changed component metadata', () => {
    const validation = validateRunbookLiveness(createRunbook(), [
      createNode('payment-db', 'OBJECT_STORAGE'),
    ]);

    expect(validation.isAlive).toBe(false);
    expect(validation.staleReferences).toContainEqual(
      expect.objectContaining({
        referencedResourceId: 'payment-db',
        issue: 'resource_changed',
      }),
    );
  });
});

function createRunbook(
  overrides: {
    readonly stepCommand?: string;
  } = {},
): DRPRunbook {
  return {
    drpPlanId: 'drp-1',
    generatedAt: '2026-04-08T00:00:00.000Z',
    disclaimer: 'test',
    confidentialityWarning: 'test',
    componentRunbooks: [
      {
        componentId: 'payment-db',
        componentName: 'payment-db',
        componentType: 'DATABASE',
        strategy: 'backup_restore',
        prerequisites: [],
        steps: [
          {
            order: 1,
            title: 'restore',
            description: 'Restore database',
            command: {
              type: 'aws_cli',
              command:
                overrides.stepCommand ??
                'aws rds reboot-db-instance --db-instance-identifier payment-db',
              description: 'Restore payment-db',
            },
            estimatedMinutes: 5,
            verification: null,
            requiresApproval: false,
            notes: [],
          },
        ],
        rollback: {
          description: 'rollback',
          steps: [],
        },
        finalValidation: null,
        warnings: [],
      },
    ],
  };
}

function createNode(id: string, type: string): InfraNodeAttrs {
  return {
    id,
    name: id,
    type,
    provider: 'aws',
    region: 'eu-west-3',
    availabilityZone: 'eu-west-3a',
    tags: {},
    metadata: {
      dbIdentifier: id,
    },
  };
}
