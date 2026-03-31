import type { InfraNodeAttrs, ScanEdge } from '../types/infrastructure.js';

/** Represents the result of a single infrastructure scan. */
export interface ScanRecord {
  readonly scanId: string;
  readonly provider: string;
  readonly region: string;
  readonly timestamp: Date;
  readonly nodes: readonly InfraNodeAttrs[];
  readonly edges: readonly ScanEdge[];
  readonly metadata: Record<string, unknown>;
}

/** Port for persisting and retrieving scan results. */
export interface ScanRepository {
  saveScan(result: ScanRecord): Promise<void>;
  getScan(scanId: string): Promise<ScanRecord | null>;
  getLatestScan(provider: string): Promise<ScanRecord | null>;
}
