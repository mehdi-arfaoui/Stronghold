import type { ValidationSeverity } from '../validation/index.js';

export type FindingStatus = 'active' | 'resolved' | 'recurrent';

export interface FindingLifecycle {
  readonly findingKey: string;
  readonly ruleId: string;
  readonly nodeId: string;
  readonly severity?: ValidationSeverity;
  readonly status: FindingStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly resolvedAt?: string;
  readonly recurrenceCount: number;
  readonly isRecurrent: boolean;
  readonly ageInDays: number;
  readonly serviceId?: string;
  readonly serviceName?: string;
}

export interface StoredFindingLifecycle {
  readonly findingKey: string;
  readonly ruleId: string;
  readonly nodeId: string;
  readonly severity?: ValidationSeverity;
  readonly status: FindingStatus;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly resolvedAt?: string;
  readonly recurrenceCount: number;
  readonly isRecurrent: boolean;
  readonly serviceId?: string;
  readonly serviceName?: string;
}

export interface TrackedFinding {
  readonly findingKey: string;
  readonly ruleId: string;
  readonly nodeId: string;
  readonly severity: ValidationSeverity;
  readonly serviceId?: string;
  readonly serviceName?: string;
}

export interface FindingLifecycleDelta {
  readonly newFindings: readonly FindingLifecycle[];
  readonly resolvedFindings: readonly FindingLifecycle[];
  readonly recurrentFindings: readonly FindingLifecycle[];
  readonly persistentFindings: readonly FindingLifecycle[];
  readonly summary: {
    readonly newCount: number;
    readonly resolvedCount: number;
    readonly recurrentCount: number;
    readonly persistentCount: number;
  };
}

export interface FindingLifecycleStore {
  upsert(lifecycle: FindingLifecycle): Promise<void>;
  getByKey(findingKey: string, asOf?: string): Promise<FindingLifecycle | null>;
  getActive(asOf?: string): Promise<readonly FindingLifecycle[]>;
  getResolved(since?: string, asOf?: string): Promise<readonly FindingLifecycle[]>;
  getRecurrent(asOf?: string): Promise<readonly FindingLifecycle[]>;
  getAll(asOf?: string): Promise<readonly FindingLifecycle[]>;
}
