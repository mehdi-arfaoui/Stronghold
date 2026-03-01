import { describe, expect, it } from 'vitest';
import {
  filterRisks,
  getRiskCriticityLevel,
  getRiskScore,
  truncateRiskTitle,
} from '@/lib/riskAnalysis';
import type { Risk } from '@/types/risks.types';

function createRisk(overrides: Partial<Risk>): Risk {
  return {
    id: overrides.id || 'risk-1',
    title: overrides.title || 'Primary database SPOF',
    description: overrides.description || 'A failure would stop core services.',
    category: overrides.category || 'availability',
    probability: overrides.probability ?? 3,
    impact: overrides.impact ?? 4,
    severity: overrides.severity || 'high',
    autoDetected: overrides.autoDetected ?? true,
    relatedNodes: overrides.relatedNodes ?? [],
    mitigations: overrides.mitigations ?? [],
    createdAt: overrides.createdAt || new Date().toISOString(),
    ...overrides,
  };
}

describe('riskAnalysis', () => {
  it('derives criticity levels from score thresholds', () => {
    expect(getRiskCriticityLevel(20)).toBe('critical');
    expect(getRiskCriticityLevel(12)).toBe('high');
    expect(getRiskCriticityLevel(6)).toBe('medium');
    expect(getRiskCriticityLevel(5)).toBe('low');
  });

  it('sorts by descending score and filters by active levels and matrix cell', () => {
    const risks = [
      createRisk({ id: '1', title: 'DNS failover missing', probability: 4, impact: 5 }),
      createRisk({ id: '2', title: 'Backups incomplete', probability: 3, impact: 3 }),
      createRisk({ id: '3', title: 'Legacy API timeout', probability: 2, impact: 2 }),
    ];

    const result = filterRisks(risks, ['critical', 'medium'], { probability: 4, impact: 5 });

    expect(getRiskScore(risks[0]!)).toBe(20);
    expect(result.map((risk) => risk.id)).toEqual(['1']);
  });

  it('truncates long titles for matrix tooltips', () => {
    expect(truncateRiskTitle('x'.repeat(60), 20)).toBe('xxxxxxxxxxxxxxxxxxx…');
  });
});
