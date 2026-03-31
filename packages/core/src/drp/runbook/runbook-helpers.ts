import { readBoolean, readNumber, readString } from '../../graph/analysis-helpers.js';
import type {
  ComponentRunbook,
  RunbookCommand,
  RunbookRollback,
  RunbookStep,
  RunbookVerification,
} from './runbook-types.js';

interface CreateStepOptions {
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly command: RunbookCommand;
  readonly estimatedMinutes: number | null;
  readonly verification?: RunbookVerification | null;
  readonly requiresApproval?: boolean;
  readonly notes?: readonly string[];
}

interface CreateRunbookOptions {
  readonly componentId: string;
  readonly componentName: string;
  readonly componentType: string;
  readonly strategy: string;
  readonly prerequisites?: readonly string[];
  readonly steps: readonly RunbookStep[];
  readonly rollback: RunbookRollback;
  readonly finalValidation?: RunbookVerification | null;
  readonly warnings?: readonly string[];
}

const DEFAULT_REGION = 'us-east-1';

/** Creates a stable one-line AWS CLI command payload. */
export function awsCli(command: string, description: string): RunbookCommand {
  return { type: 'aws_cli', command, description };
}

/** Creates a blocking AWS wait command payload. */
export function awsWait(command: string, description: string): RunbookCommand {
  return { type: 'aws_wait', command, description };
}

/** Creates a manual instruction payload. */
export function manual(description: string): RunbookCommand {
  return { type: 'manual', description };
}

/** Creates an AWS console navigation payload. */
export function awsConsole(description: string, consoleUrl: string): RunbookCommand {
  return { type: 'aws_console', description, consoleUrl };
}

/** Creates a runbook step with defaults suitable for human execution. */
export function createStep(options: CreateStepOptions): RunbookStep {
  return {
    order: options.order,
    title: options.title,
    description: options.description,
    command: options.command,
    estimatedMinutes: options.estimatedMinutes,
    verification: options.verification ?? null,
    requiresApproval: options.requiresApproval ?? false,
    notes: options.notes ?? [],
  };
}

/** Creates a read-only verification block. */
export function verification(
  command: string,
  expectedResult: string,
): RunbookVerification {
  return { command, expectedResult };
}

/** Creates a rollback block. */
export function rollback(
  description: string,
  steps: readonly RunbookStep[],
): RunbookRollback {
  return { description, steps };
}

/** Creates a component runbook document. */
export function componentRunbook(
  options: CreateRunbookOptions,
): ComponentRunbook {
  return {
    componentId: options.componentId,
    componentName: options.componentName,
    componentType: options.componentType,
    strategy: options.strategy,
    prerequisites: options.prerequisites ?? [],
    steps: options.steps,
    rollback: options.rollback,
    finalValidation: options.finalValidation ?? null,
    warnings: options.warnings ?? [],
  };
}

/** Generates a timestamp suffix safe for resource restore names. */
export function createCollisionSafeSuffix(date: Date = new Date()): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** Resolves the most useful AWS region from scan metadata. */
export function resolveRegion(metadata: Record<string, unknown>): string {
  return (
    readString(metadata.region) ??
    readString(metadata.primaryRegion) ??
    readString(metadata.secondaryRegion) ??
    DEFAULT_REGION
  );
}

/** Resolves a secondary region if one is present. */
export function resolveSecondaryRegion(
  metadata: Record<string, unknown>,
): string | null {
  return (
    readString(metadata.secondaryRegion) ??
    readString(metadata.targetRegion) ??
    firstString(metadata.replicaRegions)
  );
}

/** Reads the first non-empty string from a list-typed metadata field. */
export function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) {
    const resolved = readString(entry);
    if (resolved) return resolved;
  }
  return null;
}

/** Reads a list of strings from arbitrary metadata. */
export function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
}

/** Reads a list of object values from arbitrary metadata. */
export function objectList(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
}

/** Joins shell-safe positional values for single-line AWS CLI commands. */
export function joinCliValues(values: readonly string[]): string {
  return values.filter((value) => value.length > 0).join(' ');
}

/** Resolves a resource identifier from metadata using ordered keys. */
export function resolveIdentifier(
  metadata: Record<string, unknown>,
  keys: readonly string[],
  fallback: string,
): string {
  for (const key of keys) {
    const resolved = readString(metadata[key]);
    if (resolved) return resolved;
  }
  return fallback;
}

/** Resolves a comma-free security group argument list for AWS CLI commands. */
export function resolveSecurityGroups(metadata: Record<string, unknown>): readonly string[] {
  return stringList(metadata.securityGroups);
}

/** Resolves an RDS subnet group name when the scan contains it. */
export function resolveSubnetGroupName(
  metadata: Record<string, unknown>,
): string | null {
  return (
    readString(metadata.dbSubnetGroupName) ??
    readString(metadata.dbSubnetGroup) ??
    readString(metadata.subnetGroupName) ??
    readString(metadata.subnetGroup)
  );
}

/** Adds an AWS CLI option only when its value is available. */
export function withOption(
  base: string,
  optionName: string,
  optionValue: string | null,
): string {
  if (!optionValue) return base;
  return `${base} ${optionName} ${optionValue}`;
}

/** Resolves the original Aurora writer when the scan captured member metadata. */
export function resolveAuroraWriterId(
  metadata: Record<string, unknown>,
): string | null {
  const writer = objectList(metadata.members).find(
    (member) => readBoolean(member.isClusterWriter) === true,
  );
  return readString(writer?.dbInstanceIdentifier) ?? readString(metadata.originalWriterId);
}

/** Detects whether the resource is backed by infrastructure-as-code signals. */
export function detectIacTool(metadata: Record<string, unknown>): string | null {
  if (readString(metadata.cloudformationStackId)) return 'CloudFormation';
  if (readString(metadata.terraformResourceAddress)) return 'Terraform';
  if (readString(metadata.pulumiUrn)) return 'Pulumi';

  const tagsValue = metadata.tags;
  if (!tagsValue || typeof tagsValue !== 'object' || Array.isArray(tagsValue)) return null;
  const tagKeys = Object.keys(tagsValue as Record<string, unknown>).map((key) => key.toLowerCase());
  if (tagKeys.includes('aws:cloudformation:stack-id')) return 'CloudFormation';
  if (tagKeys.includes('terraform')) return 'Terraform';
  if (tagKeys.includes('pulumi')) return 'Pulumi';
  return null;
}

/** Creates a generic read-only describe command for a known AWS resource kind. */
export function buildDescribeCommand(
  componentType: string,
  componentId: string,
  metadata: Record<string, unknown>,
): string | null {
  const region = resolveRegion(metadata);

  switch (componentType) {
    case 'aurora-cluster':
      return `aws rds describe-db-clusters --db-cluster-identifier ${resolveIdentifier(metadata, ['dbClusterIdentifier'], componentId)} --region ${region}`;
    case 'rds':
    case 'rds-instance':
      return `aws rds describe-db-instances --db-instance-identifier ${resolveIdentifier(metadata, ['dbIdentifier', 'dbInstanceIdentifier'], componentId)} --region ${region}`;
    case 's3':
    case 's3-bucket':
      return `aws s3api get-bucket-versioning --bucket ${resolveIdentifier(metadata, ['bucketName'], componentId)} --region ${region}`;
    case 'ec2':
    case 'ec2-instance':
      return `aws ec2 describe-instances --instance-ids ${resolveIdentifier(metadata, ['instanceId'], componentId)} --region ${region}`;
    case 'dynamodb':
    case 'dynamodb-table':
      return `aws dynamodb describe-table --table-name ${resolveIdentifier(metadata, ['tableName'], componentId)} --region ${region}`;
    case 'elasticache':
      return `aws elasticache describe-cache-clusters --cache-cluster-id ${resolveIdentifier(metadata, ['cacheClusterId'], componentId)} --show-cache-node-info --region ${region}`;
    case 'efs':
    case 'efs-filesystem':
      return `aws efs describe-file-systems --file-system-id ${resolveIdentifier(metadata, ['fileSystemId'], componentId)} --region ${region}`;
    case 'lambda':
    case 'lambda-function':
      return `aws lambda get-function --function-name ${resolveIdentifier(metadata, ['functionName'], componentId)} --region ${region}`;
    case 'eks':
    case 'eks-cluster':
      return `aws eks describe-cluster --name ${resolveIdentifier(metadata, ['clusterName'], componentId)} --region ${region}`;
    case 'route53-record':
      return `aws route53 list-resource-record-sets --hosted-zone-id ${resolveIdentifier(metadata, ['hostedZoneId'], componentId)}`;
    default:
      return componentId.startsWith('arn:')
        ? `aws resourcegroupstaggingapi get-resources --resource-arn-list ${componentId} --region ${region}`
        : null;
  }
}

/** Returns the first enabled EFS replication target region. */
export function resolveReplicationDestination(
  metadata: Record<string, unknown>,
): Record<string, unknown> | null {
  return (
    objectList(metadata.replicationConfigurations).find(
      (entry) => (readString(entry.status) ?? '').toUpperCase() === 'ENABLED',
    ) ?? objectList(metadata.replicationConfigurations)[0] ?? null
  );
}

/** Resolves the latest-restorable-time capability for PITR-based runbooks. */
export function hasLatestRestorableTime(metadata: Record<string, unknown>): boolean {
  return Boolean(readString(metadata.latestRestorableTime));
}

/** Resolves the DynamoDB PITR signal from scan metadata. */
export function hasPointInTimeRecovery(metadata: Record<string, unknown>): boolean {
  return (
    readBoolean(metadata.pointInTimeRecoveryEnabled) === true ||
    readBoolean(metadata.pointInTimeRecovery) === true ||
    readBoolean(metadata.pitrEnabled) === true
  );
}

/** Reads a numeric TTL-like value when present. */
export function resolveTtl(metadata: Record<string, unknown>, fallback: number): number {
  return readNumber(metadata.ttl) ?? fallback;
}
