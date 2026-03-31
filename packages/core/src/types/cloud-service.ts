/** Cloud service resolution types for provider-aware analysis. */

export type CloudProvider = 'aws' | 'azure' | 'gcp' | 'other';

export type CloudServiceCategory =
  | 'compute'
  | 'database_relational'
  | 'database_nosql'
  | 'cache'
  | 'storage'
  | 'serverless'
  | 'messaging'
  | 'kubernetes'
  | 'loadbalancer'
  | 'unknown';

export interface CloudServiceResolution {
  readonly provider: CloudProvider;
  readonly category: CloudServiceCategory;
  readonly kind: string;
  readonly nodeType: string;
  readonly sourceType: string;
  readonly metadata: Record<string, unknown>;
  readonly descriptors: string[];
}
