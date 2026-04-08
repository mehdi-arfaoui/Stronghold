import { describe, expect, it } from 'vitest';

import type { Service } from '../../services/service-types.js';
import { resolveOwnership } from '../ownership-resolver.js';
import type { GovernanceConfig } from '../governance-types.js';

describe('resolveOwnership', () => {
  it('marks confirmed owners within the review cycle as confirmed', () => {
    const resolved = resolveOwnership(
      [createService('payment')],
      createGovernance({
        payment: {
          owner: 'team-backend',
          confirmed: true,
          confirmedAt: '2026-03-15T10:00:00Z',
          reviewCycleDays: 90,
        },
      }),
      new Date('2026-04-08T00:00:00Z'),
    );

    expect(resolved[0]?.owner).toBe('team-backend');
    expect(resolved[0]?.governance).toEqual({
      owner: 'team-backend',
      ownerStatus: 'confirmed',
      confirmedAt: '2026-03-15T10:00:00Z',
      nextReviewAt: '2026-06-13T10:00:00.000Z',
    });
  });

  it('marks confirmed owners past the review cycle as review_due', () => {
    const resolved = resolveOwnership(
      [createService('payment')],
      createGovernance({
        payment: {
          owner: 'team-backend',
          confirmed: true,
          confirmedAt: '2026-01-01T00:00:00Z',
          reviewCycleDays: 30,
        },
      }),
      new Date('2026-04-08T00:00:00Z'),
    );

    expect(resolved[0]?.governance?.ownerStatus).toBe('review_due');
  });

  it('marks declared but unconfirmed owners as unconfirmed', () => {
    const resolved = resolveOwnership(
      [createService('auth')],
      createGovernance({
        auth: {
          owner: 'team-platform',
          confirmed: false,
          reviewCycleDays: 90,
        },
      }),
      new Date('2026-04-08T00:00:00Z'),
    );

    expect(resolved[0]?.governance).toEqual({
      owner: 'team-platform',
      ownerStatus: 'unconfirmed',
    });
  });

  it('marks services with no governance ownership as none', () => {
    const resolved = resolveOwnership(
      [createService('analytics')],
      createGovernance({}),
      new Date('2026-04-08T00:00:00Z'),
    );

    expect(resolved[0]?.owner).toBeUndefined();
    expect(resolved[0]?.governance).toEqual({
      ownerStatus: 'none',
    });
  });

  it('lets governance ownership override services.yml ownership', () => {
    const resolved = resolveOwnership(
      [createService('payment', { owner: 'team-legacy' })],
      createGovernance({
        payment: {
          owner: 'team-backend',
          confirmed: false,
          reviewCycleDays: 90,
        },
      }),
    );

    expect(resolved[0]?.owner).toBe('team-backend');
    expect(resolved[0]?.governance?.ownerStatus).toBe('unconfirmed');
  });

  it('falls back to services.yml owners when governance is absent', () => {
    const resolved = resolveOwnership([createService('payment', { owner: 'team-backend' })], null);

    expect(resolved[0]?.owner).toBe('team-backend');
    expect(resolved[0]?.governance).toBeUndefined();
  });
});

function createService(
  id: string,
  options: {
    readonly owner?: string;
  } = {},
): Service {
  return {
    id,
    name: id,
    criticality: 'medium',
    detectionSource: {
      type: 'manual',
      file: '.stronghold/services.yml',
      confidence: 1.0,
    },
    resources: [],
    ...(options.owner ? { owner: options.owner } : {}),
    metadata: {},
  };
}

function createGovernance(
  ownership: GovernanceConfig['ownership'],
): GovernanceConfig {
  return {
    version: 1,
    ownership,
    riskAcceptances: [],
    policies: [],
  };
}
