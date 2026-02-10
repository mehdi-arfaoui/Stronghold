export type ScenarioType =
  | 'region_loss'
  | 'ransomware'
  | 'database_failure'
  | 'network_partition'
  | 'third_party_outage'
  | 'dns_failure'
  | 'custom';

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
    nodeId: string;
    nodeName: string;
    nodeType: string;
    impactType: 'direct' | 'cascade' | 'degraded';
    impactSeverity: 'critical' | 'major' | 'minor';
    description: string;
  }>;
  impactedNodes: Array<{
    id: string;
    name: string;
    type: string;
    status: 'down' | 'degraded' | 'at_risk' | 'healthy';
    impactedAt: number;
    estimatedRecovery: number;
  }>;
  remediationActions: Array<{
    id: string;
    title: string;
    status: 'pending' | 'in_progress' | 'completed';
    priority: 'P0' | 'P1' | 'P2';
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
