import { tryParseArn } from '../../identity/index.js';
import type { AccountScanResult } from '../../orchestration/types.js';
import type { GraphInstance } from '../../graph/graph-instance.js';
import type { SingleDetector } from '../cross-account-detector.js';
import type { CrossAccountEdge } from '../types.js';
import {
  buildCrossAccountCompleteness,
  collectNodes,
  getMetadata,
  getNodeAccountId,
  readRecordArray,
  readString,
} from './detector-utils.js';

interface ServiceReferenceCandidate {
  readonly targetArn: string;
  readonly referenceType: string;
  readonly fieldPath: string;
}

const REFERENCE_SOURCE_KINDS = [
  'ecs-service',
  'ecs-task-definition',
  'lambda',
  'eventbridge-rule',
  'eventbridge-target',
  'sfn-state-machine',
  'step-function-state-machine',
] as const;

export class ServiceReferenceDetector implements SingleDetector {
  public readonly kind = 'service_reference' as const;

  public detect(
    mergedGraph: GraphInstance,
    _accountResults: readonly AccountScanResult[],
  ): CrossAccountEdge[] {
    const edges = new Map<string, CrossAccountEdge>();

    for (const node of collectNodes(mergedGraph, REFERENCE_SOURCE_KINDS)) {
      const sourceAccountId = getNodeAccountId(node.attrs);
      if (!sourceAccountId) {
        continue;
      }

      const metadata = getMetadata(node.attrs);
      const sourceType = readString(metadata.sourceType)?.toLowerCase() ?? 'unknown';
      for (const reference of collectServiceReferences(metadata)) {
        const parsedTarget = tryParseArn(reference.targetArn);
        if (!parsedTarget?.accountId || parsedTarget.accountId === sourceAccountId) {
          continue;
        }

        const edge = buildCrossAccountCompleteness(mergedGraph, {
          sourceArn: node.arn,
          sourceAccountId,
          targetArn: reference.targetArn,
          targetAccountId: parsedTarget.accountId,
          kind: 'service_reference',
          direction: 'unidirectional',
          drImpact: inferDrImpact(reference.referenceType),
          metadata: {
            kind: 'service_reference',
            sourceResourceArn: node.arn,
            targetArn: reference.targetArn,
            sourceType,
            referenceType: reference.referenceType,
            fieldPath: reference.fieldPath,
          },
        });

        edges.set(`${edge.sourceArn}:${edge.targetArn}:${reference.referenceType}`, edge);
      }
    }

    return [...edges.values()];
  }
}

function collectServiceReferences(
  metadata: Record<string, unknown>,
): readonly ServiceReferenceCandidate[] {
  const references: ServiceReferenceCandidate[] = [];
  const sourceType = readString(metadata.sourceType)?.toLowerCase() ?? '';

  addDirectArnReference(references, metadata.taskRoleArn, 'ecs_task_role', 'taskRoleArn');
  addDirectArnReference(
    references,
    metadata.executionRoleArn,
    'ecs_execution_role',
    'executionRoleArn',
  );
  addDirectArnReference(references, metadata.roleArn, 'service_role', 'roleArn');
  addDirectArnReference(
    references,
    readNestedString(metadata.deadLetterConfig, 'targetArn'),
    'lambda_dead_letter',
    'deadLetterConfig.targetArn',
  );
  addDirectArnReference(
    references,
    metadata.deadLetterTargetArn,
    'lambda_dead_letter',
    'deadLetterTargetArn',
  );
  addDirectArnReference(
    references,
    metadata.onSuccessDestinationArn,
    'lambda_async_on_success',
    'onSuccessDestinationArn',
  );
  addDirectArnReference(
    references,
    metadata.onFailureDestinationArn,
    'lambda_async_on_failure',
    'onFailureDestinationArn',
  );
  addDirectArnReference(references, metadata.targetArn, 'eventbridge_target', 'targetArn');

  for (const mapping of readRecordArray(metadata.eventSourceMappings)) {
    addDirectArnReference(
      references,
      mapping.eventSourceArn,
      'lambda_event_source',
      'eventSourceMappings[].eventSourceArn',
    );
    addDirectArnReference(
      references,
      readNestedString(readRecord(mapping.destinationConfig)?.onFailure, 'destination'),
      'lambda_event_source_on_failure',
      'eventSourceMappings[].destinationConfig.onFailure.destination',
    );
  }

  const asyncDestinationConfig =
    readRecord(readRecord(metadata.asyncInvokeConfig)?.destinationConfig) ??
    readRecord(readRecord(metadata.eventInvokeConfig)?.destinationConfig);
  addDirectArnReference(
    references,
    readNestedString(asyncDestinationConfig?.onSuccess, 'destination'),
    'lambda_async_on_success',
    'asyncInvokeConfig.destinationConfig.onSuccess.destination',
  );
  addDirectArnReference(
    references,
    readNestedString(asyncDestinationConfig?.onFailure, 'destination'),
    'lambda_async_on_failure',
    'asyncInvokeConfig.destinationConfig.onFailure.destination',
  );

  for (const secret of readRecordArray(metadata.secretReferences)) {
    addDirectArnReference(
      references,
      secret.targetArn ?? secret.valueFrom,
      'ecs_secret',
      'secretReferences[].targetArn',
    );
  }
  for (const image of readRecordArray(metadata.ecrImageReferences)) {
    addDirectArnReference(
      references,
      image.repositoryArn,
      'ecs_ecr_image',
      'ecrImageReferences[].repositoryArn',
    );
  }

  addStringArrayReferences(
    references,
    metadata.targetArns,
    'eventbridge_target',
    'targetArns[]',
  );
  addStringArrayReferences(
    references,
    metadata.targetRoleArns,
    'eventbridge_target_role',
    'targetRoleArns[]',
  );
  addStringArrayReferences(
    references,
    metadata.targetDeadLetterArns,
    'eventbridge_target_dead_letter',
    'targetDeadLetterArns[]',
  );
  addStringArrayReferences(
    references,
    metadata.ecsTargetTaskDefinitionArns,
    'eventbridge_ecs_task_definition',
    'ecsTargetTaskDefinitionArns[]',
  );
  addStringArrayReferences(
    references,
    metadata.definitionResourceArns,
    'stepfunctions_task_resource',
    'definitionResourceArns[]',
  );
  if (sourceType.includes('sfn') || sourceType.includes('step_function')) {
    addStringArrayReferences(
      references,
      metadata.cloudWatchLogGroupArns,
      'cloudwatch_log_group',
      'cloudWatchLogGroupArns[]',
    );
  }
  if (sourceType.includes('ecs')) {
    addStringArrayReferences(
      references,
      metadata.cloudWatchLogGroupArns,
      'ecs_log_group',
      'cloudWatchLogGroupArns[]',
    );
  }
  addStringArrayReferences(
    references,
    metadata.efsFileSystemArns,
    'ecs_efs_volume',
    'efsFileSystemArns[]',
  );
  addStringArrayReferences(
    references,
    metadata.s3BucketArns,
    'ecs_s3_environment_file',
    's3BucketArns[]',
  );

  addDirectArnReference(
    references,
    readNestedString(metadata.deadLetterConfig, 'arn'),
    'eventbridge_target_dead_letter',
    'deadLetterConfig.arn',
  );
  addDirectArnReference(
    references,
    readNestedString(metadata.ecsParameters, 'taskDefinitionArn'),
    'eventbridge_ecs_task_definition',
    'ecsParameters.taskDefinitionArn',
  );

  return references;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNestedString(value: unknown, key: string): string | null {
  return readString(readRecord(value)?.[key]);
}

function addDirectArnReference(
  target: ServiceReferenceCandidate[],
  value: unknown,
  referenceType: string,
  fieldPath: string,
): void {
  const arn = readString(value);
  if (!arn?.startsWith('arn:')) {
    return;
  }

  target.push({
    targetArn: arn,
    referenceType,
    fieldPath,
  });
}

function addStringArrayReferences(
  target: ServiceReferenceCandidate[],
  value: unknown,
  referenceType: string,
  fieldPath: string,
): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const entry of value) {
    addDirectArnReference(target, entry, referenceType, fieldPath);
  }
}

function inferDrImpact(referenceType: string): CrossAccountEdge['drImpact'] {
  return referenceType.includes('dead_letter') ? 'degraded' : 'critical';
}
