/** Infrastructure graph node and edge types for the Stronghold platform. */

export enum NodeType {
  VM = 'VM',
  CONTAINER = 'CONTAINER',
  SERVERLESS = 'SERVERLESS',
  KUBERNETES_CLUSTER = 'KUBERNETES_CLUSTER',
  KUBERNETES_POD = 'KUBERNETES_POD',
  KUBERNETES_SERVICE = 'KUBERNETES_SERVICE',

  VPC = 'VPC',
  SUBNET = 'SUBNET',
  LOAD_BALANCER = 'LOAD_BALANCER',
  API_GATEWAY = 'API_GATEWAY',
  CDN = 'CDN',
  DNS = 'DNS',
  FIREWALL = 'FIREWALL',

  DATABASE = 'DATABASE',
  CACHE = 'CACHE',
  OBJECT_STORAGE = 'OBJECT_STORAGE',
  FILE_STORAGE = 'FILE_STORAGE',
  MESSAGE_QUEUE = 'MESSAGE_QUEUE',

  APPLICATION = 'APPLICATION',
  MICROSERVICE = 'MICROSERVICE',

  REGION = 'REGION',
  AVAILABILITY_ZONE = 'AVAILABILITY_ZONE',
  DATA_CENTER = 'DATA_CENTER',

  THIRD_PARTY_API = 'THIRD_PARTY_API',
  SAAS_SERVICE = 'SAAS_SERVICE',

  PHYSICAL_SERVER = 'PHYSICAL_SERVER',
  NETWORK_DEVICE = 'NETWORK_DEVICE',
}

export enum EdgeType {
  RUNS_ON = 'RUNS_ON',
  CONNECTS_TO = 'CONNECTS_TO',
  DEPENDS_ON = 'DEPENDS_ON',
  ROUTES_TO = 'ROUTES_TO',
  CONTAINS = 'CONTAINS',
  REPLICATES_TO = 'REPLICATES_TO',
  BACKS_UP_TO = 'BACKS_UP_TO',
  AUTHENTICATES_VIA = 'AUTHENTICATES_VIA',
  MONITORS = 'MONITORS',
  PUBLISHES_TO = 'PUBLISHES_TO',
  SUBSCRIBES_TO = 'SUBSCRIBES_TO',
  NETWORK_ACCESS = 'network_access',
  TRIGGERS = 'triggers',
  USES = 'uses',
  DEAD_LETTER = 'dead_letter',
  PUBLISHES_TO_APPLICATIVE = 'publishes_to',
  PLACED_IN = 'placed_in',
  SECURED_BY = 'secured_by',
  IAM_ACCESS = 'iam_access',
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type EdgeProvenance = 'manual' | 'inferred' | 'aws-api';
export type CriticalitySource = 'computed' | 'manual';

/** Attributes stored on each graphology node. */
export interface InfraNodeAttrs {
  readonly id: string;
  readonly accountId?: string | null;
  readonly partition?: string | null;
  readonly service?: string | null;
  readonly resourceType?: string | null;
  readonly resourceId?: string | null;
  readonly name: string;
  readonly businessName?: string | null;
  readonly displayName?: string;
  readonly technicalName?: string;
  readonly type: string;
  readonly provider: string;
  readonly region?: string | null;
  readonly availabilityZone?: string | null;
  readonly tags: Record<string, string>;
  readonly metadata: Record<string, unknown>;
  readonly lastSeenAt?: Date | null;

  readonly criticalityScore?: number;
  readonly redundancyScore?: number;
  readonly blastRadius?: number;
  readonly isSPOF?: boolean;
  readonly isArticulationPoint?: boolean;
  readonly betweennessCentrality?: number;
  readonly dependentsCount?: number;
  readonly dependenciesCount?: number;

  readonly suggestedRTO?: number;
  readonly suggestedRPO?: number;
  readonly suggestedMTPD?: number;
  readonly validatedRTO?: number;
  readonly validatedRPO?: number;
  readonly validatedMTPD?: number;
  readonly impactCategory?: string;
  readonly financialImpactPerHour?: number;
  readonly estimatedMonthlyCost?: number;
  readonly estimatedMonthlyCostCurrency?: string | null;
  readonly estimatedMonthlyCostSource?: string | null;
  readonly estimatedMonthlyCostConfidence?: number | null;
  readonly criticalitySource?: CriticalitySource;
  readonly criticalityOverrideReason?: string | null;
}

/** Attributes stored on each graphology edge. */
export interface InfraEdgeAttrs {
  readonly type: string;
  readonly confidence: number;
  readonly inferenceMethod?: string | null;
  readonly confirmed: boolean;
  readonly metadata?: Record<string, unknown>;
  readonly provenance?: EdgeProvenance;
  readonly reason?: string;
}

/** Result of a cloud provider scan. */
export interface ScanResult {
  readonly nodes: InfraNodeAttrs[];
  readonly edges: ScanEdge[];
  readonly provider: string;
  readonly scannedAt: Date;
}

export interface ScanEdge {
  readonly source: string;
  readonly target: string;
  readonly type: string;
  readonly confidence?: number;
  readonly inferenceMethod?: string;
  readonly metadata?: Record<string, unknown>;
  readonly provenance?: EdgeProvenance;
  readonly reason?: string;
}

/** Reconciliation metrics after ingesting scan results into the graph. */
export interface ReconciliationReport {
  readonly nodesCreated: number;
  readonly nodesUpdated: number;
  readonly nodesRemoved: number;
  readonly edgesCreated: number;
  readonly edgesUpdated: number;
  readonly edgesRemoved: number;
}

export interface IngestReport extends ReconciliationReport {
  readonly provider: string;
  readonly scannedAt: Date;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly validation?: {
    readonly orphanNodes: number;
    readonly missingContainsRelations: number;
    readonly duplicateExternalIds: number;
    readonly staleNodes: number;
  };
}

/** Cloud adapter interface for provider-specific scanning. */
export interface CloudAdapter {
  scan(config: unknown): Promise<ScanResult>;
}
