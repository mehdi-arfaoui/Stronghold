import type { InfraNodeAttrs } from '../types/index.js';

/** Infrastructure node alias used by drift detection rules. */
export type InfrastructureNode = InfraNodeAttrs;

export type DriftSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type DriftCategory =
  | 'backup_changed'
  | 'redundancy_changed'
  | 'network_changed'
  | 'security_changed'
  | 'resource_added'
  | 'resource_removed'
  | 'config_changed'
  | 'dependency_changed';

/** A single infrastructure change with its DR-facing interpretation. */
export interface DriftChange {
  readonly id: string;
  readonly category: DriftCategory;
  readonly severity: DriftSeverity;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly field: string;
  readonly previousValue: unknown;
  readonly currentValue: unknown;
  readonly description: string;
  readonly drImpact: string;
  readonly affectedServices: readonly string[];
}

/** Aggregated output of a drift comparison run. */
export interface DriftReport {
  readonly scanIdBefore: string;
  readonly scanIdAfter: string;
  readonly timestamp: Date;
  readonly changes: readonly DriftChange[];
  readonly summary: {
    readonly total: number;
    readonly bySeverity: Record<DriftSeverity, number>;
    readonly byCategory: Record<DriftCategory, number>;
    readonly drpStale: boolean;
  };
}

