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
  recommendations: string[];
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
