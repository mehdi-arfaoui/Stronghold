import type { InfraNodeAttrs, ScanEdge } from '../types/infrastructure.js';
import type { DiscoveryCredentials } from '../types/discovery.js';

/** Progress update emitted during a scan. */
export interface DiscoveryProgress {
  readonly service: string;
  readonly status: 'scanning' | 'retrying' | 'completed' | 'failed';
  readonly resourceCount: number;
  readonly error?: string;
  readonly region?: string;
  readonly durationMs?: number;
  readonly retryCount?: number;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly waitMs?: number;
  readonly failureType?: string;
}

export type ProgressCallback = (progress: DiscoveryProgress) => void;

/** Options passed to a cloud provider scan. */
export interface ScanOptions {
  readonly regions?: readonly string[];
  readonly services?: readonly string[];
  readonly onProgress?: ProgressCallback;
  readonly collectMetrics?: boolean;
  readonly scannerConcurrency?: number;
  readonly scannerTimeoutMs?: number;
}

/** Output of a cloud provider scan. */
export interface ScanOutput {
  readonly nodes: readonly InfraNodeAttrs[];
  readonly edges: readonly ScanEdge[];
  readonly metadata: {
    readonly provider: string;
    readonly regions: readonly string[];
    readonly scanDuration: number;
    readonly servicesCovered: readonly string[];
    readonly timestamp: Date;
  };
}

/** Interface every cloud provider adapter must implement. */
export interface CloudProviderAdapter {
  readonly name: string;
  scan(credentials: DiscoveryCredentials, options?: ScanOptions): Promise<ScanOutput>;
}
