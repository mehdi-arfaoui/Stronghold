export interface PostureTrend {
  readonly global: {
    readonly direction: TrendDirection;
    readonly scoreTrend: readonly TrendPoint[];
    readonly proofOfRecoveryTrend: readonly TrendPoint[];
    readonly observedCoverageTrend: readonly TrendPoint[];
    readonly findingTrend: readonly TrendPoint[];
    readonly scenarioCoverageTrend: readonly TrendPoint[];
  };
  readonly services: readonly ServiceTrend[];
  readonly evidenceTrend: {
    readonly testedCount: readonly TrendPoint[];
    readonly expiredCount: readonly TrendPoint[];
  };
  readonly highlights: readonly TrendHighlight[];
}

export interface TrendPoint {
  readonly timestamp: string;
  readonly value: number;
}

export interface ServiceTrend {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly direction: TrendDirection;
  readonly scoreTrend: readonly TrendPoint[];
  readonly debtTrend: readonly TrendPoint[];
}

export type TrendDirection = 'improving' | 'stable' | 'degrading';

export interface TrendHighlight {
  readonly type: HighlightType;
  readonly message: string;
  readonly severity: 'info' | 'warning' | 'critical';
}

export type HighlightType =
  | 'score_improved'
  | 'score_degraded'
  | 'new_critical_finding'
  | 'critical_resolved'
  | 'scenario_uncovered'
  | 'scenario_covered'
  | 'evidence_expired'
  | 'debt_milestone'
  | 'finding_recurrent'
  | 'first_scan';
