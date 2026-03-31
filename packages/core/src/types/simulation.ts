/** Failure simulation, war room, and recovery scenario types. */

import type { CascadeNode } from './analysis.js';

export interface SimulationScenario {
  readonly scenarioType: string;
  readonly params: Record<string, unknown>;
  readonly name?: string;
}

export interface SimulationBusinessImpact {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly impact: 'total_outage' | 'degraded' | 'partial';
  readonly estimatedRTO: number;
  readonly estimatedRPO: number;
  readonly financialImpactPerHour: number;
}

export interface BlastRadiusMetrics {
  readonly totalNodesImpacted: number;
  readonly totalNodesInGraph: number;
  readonly impactPercentage: number;
  readonly criticalServicesImpacted: number;
  readonly estimatedDowntimeMinutes: number;
  readonly propagationDepth: number;
  readonly recoveryComplexity: 'low' | 'medium' | 'high' | 'critical';
}

export interface SimulationRecommendation {
  readonly id: string;
  readonly priority: 'P0' | 'P1' | 'P2';
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly estimatedRto: number;
  readonly affectedNodes: string[];
  readonly category: 'failover' | 'backup' | 'redundancy' | 'isolation' | 'monitoring' | 'process';
  readonly effort: 'low' | 'medium' | 'high';
  readonly normativeReference?: string;
}

export interface SimulationPropagationEvent {
  readonly timestampMinutes: number;
  readonly delaySeconds: number;
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly impactType: 'initial_failure' | 'direct_cascade' | 'indirect_cascade' | 'degraded';
  readonly impactSeverity: 'critical' | 'major' | 'minor';
  readonly edgeType: string;
  readonly parentNodeId: string | null;
  readonly parentNodeName: string | null;
  readonly description: string;
}

export interface WarRoomImpactedNode {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly status: 'down' | 'degraded' | 'at_risk' | 'healthy';
  readonly impactedAt: number;
  readonly impactedAtSeconds: number;
  readonly estimatedRecovery: number;
}

export interface WarRoomData {
  readonly propagationTimeline: SimulationPropagationEvent[];
  readonly impactedNodes: WarRoomImpactedNode[];
  readonly remediationActions: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly status: 'pending' | 'in_progress' | 'completed';
    readonly priority: 'P0' | 'P1' | 'P2';
  }>;
}

export interface WarRoomCostTimelinePoint {
  readonly timestampMinutes: number;
  readonly timestampSeconds: number;
  readonly cumulativeBusinessLoss: number;
  readonly activeHourlyCost: number;
}

export interface WarRoomNodeCostBreakdown {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly costPerHour: number;
  readonly totalCost: number;
  readonly recoveryCost: number;
  readonly rtoMinutes: number;
  readonly downtimeMinutes: number;
  readonly downtimeSeconds: number;
  readonly impactedAtSeconds: number;
  readonly costSource?: 'bia_configured' | 'infra_estimated' | 'fallback';
  readonly costSourceLabel?: string;
  readonly recoveryStrategy?: string;
  readonly monthlyDrCost?: number;
  readonly recoveryActivationFactor?: number;
}

export interface WarRoomFinancial {
  readonly hourlyDowntimeCost: number;
  readonly recoveryCostEstimate: number;
  readonly projectedBusinessLoss: number;
  readonly totalDurationSeconds: number;
  readonly totalDurationMinutes: number;
  readonly costConfidence: 'reliable' | 'approximate' | 'gross';
  readonly costConfidenceLabel: string;
  readonly biaCoverageRatio: number;
  readonly trackedNodeCount: number;
  readonly cumulativeLossTimeline: WarRoomCostTimelinePoint[];
  readonly nodeCostBreakdown: WarRoomNodeCostBreakdown[];
}

export interface SimulationResult {
  readonly id: string;
  readonly scenario: SimulationScenario;
  readonly executedAt: Date;
  readonly directlyAffected: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly type: string;
    readonly status: string;
  }>;
  readonly cascadeImpacted: CascadeNode[];
  readonly businessImpact: SimulationBusinessImpact[];
  readonly metrics: {
    readonly totalNodesAffected: number;
    readonly percentageInfraAffected: number;
    readonly estimatedDowntimeMinutes: number;
    readonly estimatedFinancialLoss: number;
    readonly servicesWithTotalOutage: number;
    readonly servicesWithDegradation: number;
  };
  readonly blastRadiusMetrics: BlastRadiusMetrics;
  readonly recommendations: SimulationRecommendation[];
  readonly warRoomData: WarRoomData;
  readonly warRoomFinancial?: WarRoomFinancial;
  readonly postIncidentResilienceScore: number;
}

/** DR recovery strategy definition. */
export interface RecoveryStrategy {
  readonly type: 'active_active' | 'warm_standby' | 'pilot_light' | 'backup_restore';
  readonly description: string;
  readonly targetRTO: number;
  readonly targetRPO: number;
  readonly components: string[];
}

export interface LandingZoneItem {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly priorityScore: number;
  readonly recoveryTier: number;
  readonly strategy: RecoveryStrategy;
  readonly estimatedCost: number;
  readonly riskOfInaction: number;
  readonly prerequisites: string[];
}

export interface LandingZoneReport {
  readonly generatedAt: Date;
  readonly recommendations: LandingZoneItem[];
  readonly summary: {
    readonly totalServices: number;
    readonly tier1Count: number;
    readonly estimatedTotalCost: number;
    readonly estimatedRiskReduction: number;
  };
}

/** Scenario template for simulation presets. */
export interface ScenarioTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly params: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly options?: string | string[];
    readonly optional?: boolean;
  }>;
}
