export interface ScanConfig {
  providers: ProviderConfig[];
}

export interface ProviderConfig {
  provider: string;
  credentials: Record<string, string>;
  regions?: string[];
  options?: Record<string, unknown>;
}

export type ScanJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ScanJob {
  id: string;
  status: ScanJobStatus;
  progress: number;
  adapters: AdapterProgress[];
  nodesFound: number;
  edgesFound: number;
  inferredEdges: number;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface AdapterProgress {
  adapter: string;
  provider: string;
  region?: string;
  status: ScanJobStatus;
  resourcesFound: number;
  error?: string;
}

export interface DiscoverySchedule {
  id: string;
  provider: string;
  regions: string[];
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export interface CredentialTestResult {
  success: boolean;
  message: string;
  regionsFound?: number;
  accountsFound?: number;
}


export interface ScanHealthIssue {
  code: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface ScanHealthProvider {
  name: string;
  status: 'connected' | 'partial' | 'error' | 'not_configured';
  lastScanAt: string | null;
  resourceCounts: Record<string, number>;
  errors: ScanHealthIssue[];
  coveragePercentage: number;
}

export interface ScanHealthReport {
  providers: ScanHealthProvider[];
  graphConsistency: {
    orphanNodes: number;
    missingReverseEdges: number;
    staleNodes: number;
    totalNodes: number;
    totalEdges: number;
  };
}
