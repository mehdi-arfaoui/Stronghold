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
  CROSS_ACCOUNT = 'cross_account',
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
export type EcsResourceType =
  | 'ECS_CLUSTER'
  | 'ECS_SERVICE'
  | 'ECS_TASK_DEFINITION'
  | 'ECS_TASK'
  | 'ECS_CAPACITY_PROVIDER';
export type EventBridgeResourceType =
  | 'EVENTBRIDGE_BUS'
  | 'EVENTBRIDGE_RULE'
  | 'EVENTBRIDGE_TARGET';
export type LambdaResourceType = 'LAMBDA';
export type StepFunctionsResourceType = 'SFN_STATE_MACHINE';

export interface EventBridgeTargetDeadLetterConfig {
  readonly arn: string;
}

export interface EventBridgeTargetRetryPolicy {
  readonly maximumRetryAttempts: number;
  readonly maximumEventAgeInSeconds: number;
}

export interface EventBridgeBusMetadata {
  readonly name: string;
  readonly eventBusName: string;
  readonly eventBusArn: string;
  readonly state: string;
  readonly policy: string | null;
}

export interface EventBridgeRuleMetadata {
  readonly name: string;
  readonly eventBusName: string;
  readonly state: string;
  readonly scheduleExpression: string | null;
  readonly eventPattern: string | null;
  readonly description: string | null;
  readonly targetsCount: number;
  readonly managedBy: string | null;
}

export interface EventBridgeTargetMetadata {
  readonly id: string;
  readonly ruleArn: string;
  readonly targetArn: string;
  readonly inputTransformer: boolean;
  readonly deadLetterConfig: EventBridgeTargetDeadLetterConfig | null;
  readonly retryPolicy: EventBridgeTargetRetryPolicy | null;
}

export interface StepFunctionsLoggingConfiguration {
  readonly level: string;
  readonly includeExecutionData: boolean;
  readonly destinations: readonly {
    readonly cloudWatchLogsLogGroup: {
      readonly logGroupArn: string;
    };
  }[];
}

export interface StepFunctionsTracingConfiguration {
  readonly enabled: boolean;
}

export interface StepFunctionsTaskRetry {
  readonly errorEquals: readonly string[];
  readonly intervalSeconds: number;
  readonly maxAttempts: number;
  readonly backoffRate: number;
}

export interface StepFunctionsTaskCatch {
  readonly errorEquals: readonly string[];
  readonly next: string;
}

export interface StepFunctionsTaskState {
  readonly name: string;
  readonly resource: string;
  readonly service: string | null;
  readonly timeoutSeconds: number | null;
  readonly heartbeatSeconds: number | null;
  readonly retry: readonly StepFunctionsTaskRetry[] | null;
  readonly catch: readonly StepFunctionsTaskCatch[] | null;
  readonly next: string | null;
  readonly end: boolean;
  readonly isTerminal: boolean;
}

export interface StepFunctionsParsedDefinition {
  readonly totalStates: number;
  readonly taskStates: readonly StepFunctionsTaskState[];
  readonly waitStates: number;
  readonly parallelStates: number;
  readonly hasTimeout: boolean;
}

export interface StepFunctionsStateMachineMetadata {
  readonly name: string;
  readonly stateMachineArn: string;
  readonly type: string;
  readonly status: string;
  readonly roleArn: string;
  readonly definition: string;
  readonly loggingConfiguration: StepFunctionsLoggingConfiguration | null;
  readonly tracingConfiguration: StepFunctionsTracingConfiguration | null;
  readonly parsedDefinition: StepFunctionsParsedDefinition;
}

export interface LambdaDeadLetterConfig {
  readonly targetArn: string;
}

export interface LambdaDestinationTarget {
  readonly destination: string;
}

export interface LambdaEventSourceMappingDestinationConfig {
  readonly onFailure: LambdaDestinationTarget | null;
}

export interface LambdaEventSourceMappingAttributes {
  readonly uuid: string;
  readonly eventSourceArn: string;
  readonly state: string;
  readonly batchSize: number | null;
  readonly maximumRetryAttempts: number | null;
  readonly bisectBatchOnFunctionError: boolean | null;
  readonly destinationConfig: LambdaEventSourceMappingDestinationConfig | null;
  readonly functionResponseTypes: readonly string[];
}

export interface LambdaProvisionedConcurrencyAttributes {
  readonly allocatedConcurrency: number;
  readonly availableConcurrency: number;
  readonly status: string;
  readonly aliasOrVersion: string;
}

export interface LambdaAsyncInvokeDestinationConfig {
  readonly onSuccess: LambdaDestinationTarget | null;
  readonly onFailure: LambdaDestinationTarget | null;
}

export interface LambdaAsyncInvokeConfig {
  readonly maximumRetryAttempts: number;
  readonly maximumEventAgeInSeconds: number;
  readonly destinationConfig: LambdaAsyncInvokeDestinationConfig | null;
}

export interface LambdaLayerAttributes {
  readonly arn: string;
  readonly codeSize: number;
}

export interface LambdaEnvironmentReference {
  readonly varName: string;
  readonly referenceType: string;
  readonly value: string;
}

export interface LambdaDependencyEdgeAttributes {
  readonly source?: string;
  readonly target: string;
  readonly type: string;
  readonly relationship: string;
  readonly metadata?: Record<string, unknown>;
}

export interface LambdaFunctionMetadata {
  readonly runtime: string | null;
  readonly handler: string | null;
  readonly functionName: string;
  readonly functionArn: string;
  readonly timeout: number | null;
  readonly memorySize: number | null;
  readonly roleArn: string | null;
  readonly region: string;
  readonly vpcId: string | null;
  readonly subnetId: string | null;
  readonly subnetIds: readonly string[];
  readonly securityGroups: readonly string[];
  readonly deadLetterConfig: LambdaDeadLetterConfig | null;
  readonly deadLetterTargetArn: string | null;
  readonly asyncInvokeConfig: LambdaAsyncInvokeConfig | null;
  readonly eventInvokeConfig: LambdaAsyncInvokeConfig | null;
  readonly onSuccessDestinationArn: string | null;
  readonly onFailureDestinationArn: string | null;
  readonly environmentVariableNames: readonly string[];
  readonly environmentReferences: readonly LambdaEnvironmentReference[];
  readonly eventSourceMappings: readonly LambdaEventSourceMappingAttributes[];
  readonly provisionedConcurrency: LambdaProvisionedConcurrencyAttributes | null;
  readonly provisionedConcurrencyConfigs: readonly Record<string, unknown>[];
  readonly provisionedConcurrencyEnabled: boolean;
  readonly reservedConcurrency: number | null;
  readonly layers: readonly LambdaLayerAttributes[];
  readonly directDependencyEdges: readonly LambdaDependencyEdgeAttributes[];
  readonly displayName: string;
  readonly awsTags?: Record<string, string>;
}

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
  readonly kind?: string;
  readonly direction?: 'unidirectional' | 'bidirectional';
  readonly drImpact?: 'critical' | 'degraded' | 'informational';
  readonly completeness?: 'complete' | 'partial';
  readonly sourceAccountId?: string;
  readonly targetAccountId?: string;
  readonly missingAccountId?: string;
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
