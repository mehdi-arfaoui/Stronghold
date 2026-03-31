/** Graph analysis, SPOF detection, and resilience report types. */

import type { Severity } from './infrastructure.js';

export interface SPOFReport {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly severity: Severity;
  readonly blastRadius: number;
  readonly impactedServices: string[];
  readonly recommendation: string;
}

export interface RedundancyCheck {
  readonly check: string;
  readonly passed: boolean;
  readonly recommendation: string;
  readonly impact: Severity;
}

export interface RedundancyIssue {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly redundancyScore: number;
  readonly failedChecks: RedundancyCheck[];
}

export interface RegionalRisk {
  readonly region: string;
  readonly concentration: number;
  readonly totalNodes: number;
  readonly criticalNodes: number;
  readonly risk: Severity;
  readonly recommendation: string;
}

export interface CircularDependency {
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly length: number;
}

export interface CascadeNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: 'down' | 'degraded';
  readonly cascadeReason: string;
  readonly cascadeDepth: number;
}

export interface CascadeChain {
  readonly sourceNodeId: string;
  readonly sourceNodeName: string;
  readonly depth: number;
  readonly totalImpacted: number;
  readonly impactedNodes: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly depth: number;
  }>;
}

export interface GraphAnalysisReport {
  readonly timestamp: Date;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly spofs: SPOFReport[];
  readonly criticalityScores: Map<string, number>;
  readonly redundancyIssues: RedundancyIssue[];
  readonly regionalRisks: RegionalRisk[];
  readonly circularDeps: CircularDependency[];
  readonly cascadeChains: CascadeChain[];
  readonly resilienceScore: number;
}

/** Critical dependency path between two nodes. */
export interface CriticalPath {
  readonly from: string;
  readonly to: string;
  readonly path: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly type: string;
  }>;
  readonly bottlenecks: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly reason: string;
  }>;
}

/** Auto-detected infrastructure risk. */
export interface AutoDetectedRisk {
  readonly id: string;
  readonly category: 'infrastructure' | 'network' | 'application' | 'external';
  readonly title: string;
  readonly description: string;
  readonly probability: number;
  readonly impact: number;
  readonly linkedNodeIds: string[];
  readonly mitigations: ReadonlyArray<{
    readonly title: string;
    readonly effort: 'low' | 'medium' | 'high';
    readonly priority: 'immediate' | 'planned' | 'strategic';
  }>;
  readonly autoDetected: boolean;
  readonly detectionMethod: string;
}
