export interface ResilienceScore {
  overall: number;
  breakdown: ScoreBreakdown[];
  trend?: number;
  lastCalculated?: string;
}

export interface ScoreBreakdown {
  category: string;
  impact: number;
  label: string;
  status: 'ok' | 'warning' | 'critical';
}

export interface SPOFItem {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  blastRadius: number;
  severity: 'critical' | 'high' | 'medium';
  reasons: string[];
}

export interface RedundancyAnalysis {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  redundancyScore: number;
  multiAZ: boolean;
  replicas: number;
  hasBackup: boolean;
  recommendations: string[];
}

export interface RegionalConcentration {
  region: string;
  provider: string;
  nodeCount: number;
  criticalNodeCount: number;
  percentage: number;
  risk: 'high' | 'medium' | 'low';
}
