export interface ScanConfig {
  providers: ProviderConfig[];
  kubernetes?: KubernetesProviderConfig[];
  onPremise?: {
    ipRanges: string[];
  };
  options?: {
    inferDependencies?: boolean;
    scanIntervalMinutes?: number;
  };
}

export interface ProviderConfig {
  type: string;
  credentials: Record<string, string>;
  regions?: string[];
  options?: Record<string, unknown>;
  provider?: string;
}

export interface KubernetesProviderConfig {
  name: string;
  kubeconfig: string;
}

export type ScanJobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type ScanAdapterStatus = ScanJobStatus | 'skipped';

export interface ScanJob {
  id: string;
  status: ScanJobStatus;
  progress: number;
  adapters: AdapterProgress[];
  nodesFound: number;
  edgesFound: number;
  inferredEdges: number;
  startedAt: string | null;
  completedAt?: string | null;
  error?: string;
  scannedProviders?: string[];
  ignoredProviders?: Array<{ provider: string; reason: string }>;
  failedProviders?: string[];
  warnings?: string[];
}

export interface AdapterProgress {
  adapter: string;
  provider: string;
  region?: string;
  status: ScanAdapterStatus;
  resourcesFound: number;
  error?: string;
}

export interface DiscoverySchedule {
  id: string;
  tenantId?: string;
  enabled: boolean;
  intervalMinutes: number;
  cronExpression?: string;
  lastScanAt?: string | null;
  nextScanAt?: string | null;
}

export interface ScanTimelineEntry {
  id: string;
  jobId: string | null;
  type: 'scheduled' | 'manual';
  occurredAt: string;
  nodes: number;
  edges: number;
  spofCount: number;
  driftCount: number;
  drifts: Array<{
    id: string;
    severity: string;
    description: string;
  }>;
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
