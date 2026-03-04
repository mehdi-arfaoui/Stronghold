import type { Risk } from '@/types/risks.types';

export type RiskCriticityLevel = 'critical' | 'high' | 'medium' | 'low';

export interface RiskCellFilter {
  probability: number;
  impact: number;
}

export function getRiskScore(risk: Risk): number {
  return Number(risk.probability || 0) * Number(risk.impact || 0);
}

export function getRiskCriticityLevel(score: number): RiskCriticityLevel {
  if (score >= 20) return 'critical';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

export function getRiskCriticityLabel(level: RiskCriticityLevel): string {
  switch (level) {
    case 'critical':
      return 'Critique';
    case 'high':
      return 'Élevé';
    case 'medium':
      return 'Moyen';
    default:
      return 'Faible';
  }
}

export function sortRisksByScore(risks: Risk[]): Risk[] {
  return [...risks].sort((left, right) => {
    const scoreDiff = getRiskScore(right) - getRiskScore(left);
    if (scoreDiff !== 0) return scoreDiff;

    const impactDiff = Number(right.impact || 0) - Number(left.impact || 0);
    if (impactDiff !== 0) return impactDiff;

    const probabilityDiff = Number(right.probability || 0) - Number(left.probability || 0);
    if (probabilityDiff !== 0) return probabilityDiff;

    return left.title.localeCompare(right.title, 'fr', { sensitivity: 'base' });
  });
}

export function filterRisks(
  risks: Risk[],
  levels: RiskCriticityLevel[],
  cellFilter?: RiskCellFilter | null,
): Risk[] {
  const activeLevels = new Set(levels);
  return sortRisksByScore(risks).filter((risk) => {
    const level = getRiskCriticityLevel(getRiskScore(risk));
    if (!activeLevels.has(level)) return false;
    if (!cellFilter) return true;
    return risk.probability === cellFilter.probability && risk.impact === cellFilter.impact;
  });
}

export function truncateRiskTitle(title: string, maxLength = 50): string {
  const normalized = title.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
