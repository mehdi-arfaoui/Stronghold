import type { Grade, WeightedValidationResult } from '../validation/validation-types.js';

export type Criticality = 'critical' | 'high' | 'medium' | 'low';

export type ResourceRole =
  | 'datastore'
  | 'compute'
  | 'network'
  | 'queue'
  | 'storage'
  | 'monitoring'
  | 'dns'
  | 'other';

export type DetectionSource =
  | { readonly type: 'cloudformation'; readonly stackName: string; readonly confidence: number }
  | {
      readonly type: 'tag';
      readonly key: string;
      readonly value: string;
      readonly confidence: number;
    }
  | {
      readonly type: 'topology';
      readonly algorithm: string;
      readonly confidence: number;
    }
  | { readonly type: 'manual'; readonly file: string; readonly confidence: 1.0 };

export interface ServiceResource {
  readonly nodeId: string;
  readonly role?: ResourceRole;
  readonly detectionSource: DetectionSource;
}

export interface Service {
  readonly id: string;
  readonly name: string;
  readonly detectionSource: DetectionSource;
  readonly resources: readonly ServiceResource[];
  readonly criticality: Criticality;
  readonly owner?: string;
  readonly metadata: {
    readonly stackName?: string;
    readonly tagKey?: string;
    readonly tagValue?: string;
    readonly clusterConfidence?: number;
  };
}

export interface ServiceDetectionSummary {
  readonly cloudformation: number;
  readonly tag: number;
  readonly topology: number;
  readonly manual: number;
  readonly totalResources: number;
  readonly assignedResources: number;
  readonly unassignedResources: number;
}

export interface ServiceDetectionResult {
  readonly services: readonly Service[];
  readonly unassignedResources: readonly string[];
  readonly detectionSummary: ServiceDetectionSummary;
}

export interface ManualServiceDefinition {
  readonly id: string;
  readonly name: string;
  readonly criticality: Criticality;
  readonly owner?: string;
  readonly resourcePatterns: readonly string[];
}

export interface LoadedManualServices {
  readonly filePath: string;
  readonly services: readonly Service[];
  readonly warnings: readonly string[];
  readonly newMatches: readonly {
    readonly serviceId: string;
    readonly serviceName: string;
    readonly resourceIds: readonly string[];
  }[];
}

export interface ServiceFinding extends WeightedValidationResult {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly resourceRole: ResourceRole;
}

export interface ServiceScore {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly resourceCount: number;
  readonly criticality: Criticality;
  readonly owner?: string;
  readonly detectionSource: DetectionSource;
  readonly score: number;
  readonly grade: Grade;
  readonly findingsCount: {
    readonly critical: number;
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly findings: readonly ServiceFinding[];
  readonly coverageGaps: readonly string[];
}

export interface ServiceScoringResult {
  readonly services: readonly ServiceScore[];
  readonly unassigned: ServiceScore | null;
}
