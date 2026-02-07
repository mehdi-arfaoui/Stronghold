export interface Risk {
  id: string;
  title: string;
  description: string;
  category: string;
  probability: number;
  impact: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  autoDetected: boolean;
  relatedNodes: string[];
  mitigations: RiskMitigation[];
  createdAt: string;
}

export interface RiskMitigation {
  id: string;
  description: string;
  status: 'proposed' | 'accepted' | 'implemented';
  effort: 'low' | 'medium' | 'high';
}

export interface RiskMatrixCell {
  probability: number;
  impact: number;
  risks: Risk[];
  count: number;
}
