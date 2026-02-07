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
