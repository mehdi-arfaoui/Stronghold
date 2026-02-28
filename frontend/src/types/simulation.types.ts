export type ScenarioType = string;

export interface SimulationConfig {
  scenarioType: ScenarioType;
  name: string;
  params: Record<string, unknown>;
}

export interface Simulation {
  id: string;
  scenarioType: ScenarioType;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  params: Record<string, unknown>;
  result?: SimulationResult;
  createdAt: string;
  completedAt?: string;
}

export interface SimulationRecommendation {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  description: string;
  action: string;
  estimatedRto: number;
  affectedNodes: string[];
  category: 'failover' | 'backup' | 'redundancy' | 'isolation' | 'monitoring' | 'process';
  effort: 'low' | 'medium' | 'high';
  normativeReference?: string;
}

export interface BlastRadiusMetrics {
  totalNodesImpacted: number;
  totalNodesInGraph: number;
  impactPercentage: number;
  criticalServicesImpacted: number;
  estimatedDowntimeMinutes: number;
  propagationDepth: number;
  recoveryComplexity: 'low' | 'medium' | 'high' | 'critical';
}

export interface WarRoomData {
  propagationTimeline: Array<{
    timestampMinutes: number;
    delaySeconds: number;
    nodeId: string;
    nodeName: string;
    nodeType: string;
    impactType: 'initial_failure' | 'direct_cascade' | 'indirect_cascade' | 'degraded';
    impactSeverity: 'critical' | 'major' | 'minor';
    edgeType: string;
    parentNodeId: string | null;
    parentNodeName: string | null;
    description: string;
  }>;
  impactedNodes: Array<{
    id: string;
    name: string;
    type: string;
    status: 'down' | 'degraded' | 'at_risk' | 'healthy';
    impactedAt: number;
    impactedAtSeconds: number;
    estimatedRecovery: number;
  }>;
  remediationActions: Array<{
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'P0' | 'P1' | 'P2';
  }>;
}

export interface WarRoomFinancial {
  hourlyDowntimeCost: number;
  recoveryCostEstimate: number;
  projectedBusinessLoss: number;
  totalDurationSeconds: number;
  totalDurationMinutes: number;
  costConfidence: 'reliable' | 'approximate' | 'gross';
  costConfidenceLabel: string;
  biaCoverageRatio: number;
  trackedNodeCount: number;
  cumulativeLossTimeline: Array<{
    timestampMinutes: number;
    timestampSeconds: number;
    cumulativeBusinessLoss: number;
    activeHourlyCost: number;
  }>;
  nodeCostBreakdown: Array<{
    nodeId: string;
    nodeName: string;
    nodeType: string;
    costPerHour: number;
    totalCost: number;
    recoveryCost: number;
    rtoMinutes: number;
    downtimeMinutes: number;
    downtimeSeconds: number;
    impactedAtSeconds: number;
    costSource?: 'bia_configured' | 'infra_estimated' | 'fallback';
    costSourceLabel?: string;
    recoveryStrategy?: string;
    monthlyDrCost?: number;
    recoveryActivationFactor?: number;
  }>;
}

export interface SimulationResult {
  nodesDown: number;
  nodesDegraded: number;
  nodesHealthy: number;
  infrastructureImpact: number;
  estimatedDowntime: number;
  financialLoss: number;
  resilienceScoreBefore: number;
  resilienceScoreAfter: number;
  affectedNodes: AffectedNode[];
  impactedServices: ImpactedService[];
  recommendations: SimulationRecommendation[];
  blastRadiusMetrics: BlastRadiusMetrics;
  warRoomData: WarRoomData;
  warRoomFinancial?: WarRoomFinancial;
  cascadeSteps: CascadeStep[];
}

export interface AffectedNode {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  status: 'down' | 'degraded';
  cascadeLevel: number;
}

export interface ImpactedService {
  serviceName: string;
  impact: 'total' | 'degraded' | 'none';
  estimatedRTO: number;
}

export interface CascadeStep {
  step: number;
  description: string;
  nodesAffected: string[];
}


export type ScenarioCategory = 'cyber' | 'infrastructure' | 'natural' | 'human';

export interface ScenarioTemplate {
  id: string;
  name: string;
  category: ScenarioCategory;
  icon: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  impactProfile: {
    targetNodeTypes: string[];
    propagationSpeed: 'instant' | 'fast' | 'gradual' | 'slow';
    propagationPattern: 'broadcast' | 'cascade' | 'targeted' | 'random';
    dataLoss: boolean;
    serviceInterruption: boolean;
    integrityCompromise: boolean;
  };
  configurableParams: Array<{
    key: string;
    label: string;
    type: 'select' | 'number' | 'boolean';
    options?: string[];
    default: unknown;
  }>;
  tags: string[];
  realWorldExample?: string;
}

export interface RecoveryPriority {
  nodeId: string;
  nodeName: string;
  score: number;
  tier: 'T0' | 'T1' | 'T2' | 'T3';
  rto: number;
  dependentCount: number;
  criticalityScore: number;
  reasoning: string;
}
