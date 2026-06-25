import { describe, expect, it } from 'vitest';

import type { ServiceInfo, SpofInfo } from '../contract-result-types.js';
import { evaluateSpofRequirement } from './spof-evaluator.js';

const SERVICE: ServiceInfo = {
  serviceId: 'svc-payment',
  serviceName: 'payment-processing',
};

describe('evaluateSpofRequirement', () => {
  it('returns met for required any', () => {
    const result = evaluateSpofRequirement('any', null, SERVICE);

    expect(result.verdict).toBe('met');
  });

  it('returns met for required none with zero SPOFs', () => {
    const result = evaluateSpofRequirement('none', [], SERVICE);

    expect(result.verdict).toBe('met');
  });

  it('returns violated for required none when SPOFs exist even if mitigated', () => {
    const result = evaluateSpofRequirement('none', [spof({ mitigated: true })], SERVICE);

    expect(result.verdict).toBe('violated');
    expect(result.reason).not.toContain('arn:aws:');
    expect(result.reason).toContain('RDS instance (primary)');
  });

  it('returns met for required mitigated when all SPOFs are mitigated', () => {
    const result = evaluateSpofRequirement('mitigated', [spof({ mitigated: true })], SERVICE);

    expect(result.verdict).toBe('met');
  });

  it('returns violated for required mitigated when one SPOF is unmitigated', () => {
    const result = evaluateSpofRequirement(
      'mitigated',
      [spof({ mitigated: true }), spof({ nodeArn: 'arn:aws:ec2:eu-west-1:123456789012:instance/i-1' })],
      SERVICE,
    );

    expect(result.verdict).toBe('violated');
    expect(result.reason).not.toContain('arn:aws:');
    expect(result.reason).toContain('EC2 instance (i-1)');
  });

  it('returns unknown when SPOF data is absent', () => {
    const result = evaluateSpofRequirement('none', null, SERVICE);

    expect(result.verdict).toBe('unknown');
  });

  it('redacts ARN values in violated reasons', () => {
    const result = evaluateSpofRequirement(
      'none',
      [
        spof({ nodeArn: 'arn:aws:rds:eu-west-1:123456789012:db:primary' }),
        spof({ nodeArn: 'arn:aws:elasticache:eu-west-1:123456789012:cluster/cache' }),
      ],
      SERVICE,
    );

    expect(result.reason).not.toContain('arn:aws:');
    expect(result.reason).toContain('RDS instance (primary)');
    expect(result.reason).toContain('ElastiCache resource (cache)');
  });
});

function spof(overrides: Partial<SpofInfo> = {}): SpofInfo {
  return {
    nodeArn: 'arn:aws:rds:eu-west-1:123456789012:db:primary',
    mitigated: false,
    ...overrides,
  };
}
