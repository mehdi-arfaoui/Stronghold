/** Business Impact Analysis (BIA) types. */

import type { Severity } from './infrastructure.js';

export interface BIAMetrics {
  readonly rto: number;
  readonly rpo: number;
  readonly mtpd: number;
  readonly mao: number;
  readonly mbco: number;
  readonly category: Severity;
}

export interface WeakPoint {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly reason: string;
  readonly severity: Severity;
}

export interface FinancialImpact {
  readonly estimatedCostPerHour: number;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly note: string;
  readonly breakdown: {
    readonly directDependents: number;
    readonly serviceType: string;
    readonly multiplier: number;
  };
}

export interface BIAProcessResult {
  readonly serviceNodeId: string;
  readonly serviceName: string;
  readonly serviceType: string;
  readonly suggestedMAO: number;
  readonly suggestedMTPD: number;
  readonly suggestedRTO: number;
  readonly suggestedRPO: number;
  readonly suggestedMBCO: number;
  readonly impactCategory: string;
  readonly criticalityScore: number;
  readonly recoveryTier: number;
  readonly dependencyChain: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly isSPOF: boolean;
  }>;
  readonly weakPoints: WeakPoint[];
  readonly financialImpact: FinancialImpact;
  readonly validationStatus: string;
}

export interface BIAReportResult {
  readonly generatedAt: Date;
  readonly processes: BIAProcessResult[];
  readonly summary: {
    readonly totalProcesses: number;
    readonly tier1Count: number;
    readonly tier2Count: number;
    readonly tier3Count: number;
    readonly tier4Count: number;
    readonly totalEstimatedImpact: number;
  };
}
