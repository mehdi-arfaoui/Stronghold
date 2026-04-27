import {
  createAccountContext,
  parseArn,
  type ParsedArn,
  type AccountContext,
} from '../identity/index.js';
import type { DiscoveryResourceKind, OpenPort } from './discovery.js';

interface ResourceIdentityExpectation {
  readonly service: string;
  readonly resourceTypes?: readonly (string | null)[];
}

const RESOURCE_IDENTITY_EXPECTATIONS: Record<string, readonly ResourceIdentityExpectation[]> = {
  ASG: [{ service: 'autoscaling', resourceTypes: ['autoscalinggroup'] }],
  AURORA_CLUSTER: [{ service: 'rds', resourceTypes: ['cluster'] }],
  AURORA_GLOBAL: [{ service: 'rds', resourceTypes: ['global-cluster'] }],
  AURORA_INSTANCE: [{ service: 'rds', resourceTypes: ['db'] }],
  BACKUP_PLAN: [{ service: 'backup', resourceTypes: ['backup-plan'] }],
  BACKUP_VAULT: [{ service: 'backup', resourceTypes: ['backup-vault'] }],
  CLOUDWATCH_ALARM: [{ service: 'cloudwatch', resourceTypes: ['alarm'] }],
  DYNAMODB: [{ service: 'dynamodb', resourceTypes: ['table'] }],
  EC2: [{ service: 'ec2', resourceTypes: ['instance'] }],
  ECS_CLUSTER: [{ service: 'ecs', resourceTypes: ['cluster'] }],
  ECS_SERVICE: [{ service: 'ecs', resourceTypes: ['service'] }],
  ECS_TASK_DEFINITION: [{ service: 'ecs', resourceTypes: ['task-definition'] }],
  ECS_TASK: [{ service: 'ecs', resourceTypes: ['task'] }],
  ECS_CAPACITY_PROVIDER: [{ service: 'ecs', resourceTypes: ['capacity-provider'] }],
  EFS_FILESYSTEM: [{ service: 'elasticfilesystem', resourceTypes: ['file-system'] }],
  EFS_MOUNT_TARGET: [{ service: 'elasticfilesystem', resourceTypes: ['mount-target'] }],
  EKS: [{ service: 'eks', resourceTypes: ['cluster'] }],
  EKS_NODEGROUP: [{ service: 'eks', resourceTypes: ['nodegroup'] }],
  ELASTICACHE: [{ service: 'elasticache', resourceTypes: ['cluster'] }],
  ELB: [{ service: 'elasticloadbalancing', resourceTypes: ['loadbalancer'] }],
  EVENTBRIDGE_BUS: [{ service: 'events', resourceTypes: ['event-bus'] }],
  EVENTBRIDGE_RULE: [{ service: 'events', resourceTypes: ['rule'] }],
  EVENTBRIDGE_TARGET: [{ service: 'events', resourceTypes: ['target'] }],
  LAMBDA: [{ service: 'lambda', resourceTypes: ['function'] }],
  NAT_GATEWAY: [{ service: 'ec2', resourceTypes: ['natgateway'] }],
  RDS: [{ service: 'rds', resourceTypes: ['db'] }],
  ROUTE53_HOSTED_ZONE: [{ service: 'route53', resourceTypes: ['hostedzone'] }],
  ROUTE53_RECORD: [{ service: 'route53', resourceTypes: ['recordset', 'rrset'] }],
  S3_BUCKET: [{ service: 's3', resourceTypes: [null] }],
  SECURITY_GROUP: [{ service: 'ec2', resourceTypes: ['security-group'] }],
  SNS_TOPIC: [{ service: 'sns', resourceTypes: [null] }],
  SQS_QUEUE: [{ service: 'sqs', resourceTypes: [null] }],
  SFN_STATE_MACHINE: [{ service: 'states', resourceTypes: ['statemachine'] }],
  STEP_FUNCTION_STATE_MACHINE: [{ service: 'states', resourceTypes: ['statemachine'] }],
  SUBNET: [{ service: 'ec2', resourceTypes: ['subnet'] }],
  VPC: [{ service: 'ec2', resourceTypes: ['vpc'] }],
};

export interface Resource {
  readonly arn: string;
  readonly account: AccountContext;
  readonly region: string | null;
  readonly service: string;
  readonly resourceType: string | null;
  readonly resourceId: string;
  readonly source: string;
  readonly name: string;
  readonly kind: DiscoveryResourceKind;
  readonly type: string;
  readonly ip?: string | null;
  readonly hostname?: string | null;
  readonly tags?: Record<string, string> | string[] | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly openPorts?: OpenPort[] | null;
}

export interface CreateResourceInput {
  readonly arn: string;
  readonly source: string;
  readonly name?: string;
  readonly kind?: DiscoveryResourceKind;
  readonly type: string;
  readonly ip?: string | null;
  readonly hostname?: string | null;
  readonly tags?: Record<string, string> | string[] | null;
  readonly metadata?: Record<string, unknown> | null;
  readonly openPorts?: OpenPort[] | null;
  readonly account?: {
    readonly accountId: string;
    readonly accountAlias?: string | null;
    readonly partition?: string;
  };
}

export class InvalidResourceError extends Error {
  public readonly input: string;

  constructor(input: string, reason: string) {
    super(`Invalid resource "${input}": ${reason}`);
    this.name = 'InvalidResourceError';
    this.input = input;
  }
}

export function createResource(input: CreateResourceInput): Resource {
  let parsed: ParsedArn;

  try {
    parsed = parseArn(input.arn);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid ARN';
    throw new InvalidResourceError(input.arn, message);
  }

  const accountId = resolveAccountId(parsed, input);
  validateAccountContext(parsed, input);
  validateResourceIdentity(parsed, input.type);

  try {
    return {
      arn: parsed.raw,
      account: createAccountContext({
        accountId,
        accountAlias: input.account?.accountAlias,
        partition: parsed.partition,
      }),
      region: parsed.region,
      service: parsed.service,
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId,
      source: input.source,
      name: input.name?.trim() || parsed.resourceId,
      kind: input.kind ?? 'infra',
      type: input.type,
      ip: input.ip ?? null,
      hostname: input.hostname ?? null,
      tags: input.tags ?? null,
      metadata: input.metadata ?? null,
      openPorts: input.openPorts ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid resource';
    throw new InvalidResourceError(input.arn, message);
  }
}

function resolveAccountId(parsed: ParsedArn, input: CreateResourceInput): string {
  if (parsed.accountId) {
    return parsed.accountId;
  }

  const providedAccountId = input.account?.accountId?.trim();
  if (providedAccountId) {
    return providedAccountId;
  }

  throw new InvalidResourceError(
    input.arn,
    'ARN does not encode an account ID and no scan account context was provided',
  );
}

function validateAccountContext(parsed: ParsedArn, input: CreateResourceInput): void {
  const providedAccountId = input.account?.accountId?.trim();
  if (parsed.accountId && providedAccountId && parsed.accountId !== providedAccountId) {
    throw new InvalidResourceError(
      input.arn,
      `ARN account "${parsed.accountId}" does not match provided account "${providedAccountId}"`,
    );
  }

  if (input.account?.partition && input.account.partition !== parsed.partition) {
    throw new InvalidResourceError(
      input.arn,
      `ARN partition "${parsed.partition}" does not match provided partition "${input.account.partition}"`,
    );
  }
}

function validateResourceIdentity(parsed: ParsedArn, strongholdType: string): void {
  const expectations = RESOURCE_IDENTITY_EXPECTATIONS[strongholdType];
  if (!expectations || expectations.length === 0) {
    return;
  }

  const normalizedResourceType = parsed.resourceType?.toLowerCase() ?? null;
  const match = expectations.some((expectation) => {
    if (parsed.service !== expectation.service) {
      return false;
    }
    if (!expectation.resourceTypes) {
      return true;
    }

    return expectation.resourceTypes.some((candidate) => candidate === normalizedResourceType);
  });

  if (match) {
    return;
  }

  const expected = expectations
    .map((expectation) =>
      expectation.resourceTypes && expectation.resourceTypes.length > 0
        ? `${expectation.service}:${expectation.resourceTypes.join('|')}`
        : expectation.service,
    )
    .join(', ');

  throw new InvalidResourceError(
    parsed.raw,
    `Stronghold type "${strongholdType}" is incompatible with ARN service/resource "${parsed.service}:${parsed.resourceType ?? '<none>'}". Expected ${expected}`,
  );
}
