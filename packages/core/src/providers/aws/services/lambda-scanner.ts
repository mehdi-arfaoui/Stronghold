/**
 * Scans AWS Lambda functions with environment reference extraction.
 */

import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionConfigurationCommand,
  ListEventSourceMappingsCommand,
} from '@aws-sdk/client-lambda';
import type { DiscoveredResource } from '../../../types/discovery.js';
import { createAwsClient, getAwsCommandOptions, type AwsClientOptions } from '../aws-client-factory.js';
import { paginateAws, buildResource } from '../scan-utils.js';

const LAMBDA_ENV_ARN_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[A-Za-z0-9\-_/.:]+/g;
const LAMBDA_ENV_SQS_URL_PATTERN =
  /https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9\-_]+/g;
const LAMBDA_ENV_RDS_ENDPOINT_PATTERN =
  /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.[A-Za-z0-9-]+\.rds\.amazonaws\.com/g;
const LAMBDA_ENV_CACHE_ENDPOINT_PATTERN = /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.cache\.amazonaws\.com/g;

interface LambdaEnvReference {
  readonly varName: string;
  readonly referenceType: string;
  readonly value: string;
}

function extractLambdaEnvironmentReferences(envVars: Record<string, string>): LambdaEnvReference[] {
  const references: LambdaEnvReference[] = [];

  for (const [varName, rawValue] of Object.entries(envVars)) {
    if (typeof rawValue !== 'string') continue;
    const value = rawValue.trim();
    if (!value) continue;
    let matchedExplicit = false;

    for (const match of value.match(LAMBDA_ENV_ARN_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'arn', value: match });
      matchedExplicit = true;
    }
    for (const match of value.match(LAMBDA_ENV_SQS_URL_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'sqs_url', value: match });
      matchedExplicit = true;
    }
    for (const match of value.match(LAMBDA_ENV_RDS_ENDPOINT_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'rds_endpoint', value: match });
      matchedExplicit = true;
    }
    for (const match of value.match(LAMBDA_ENV_CACHE_ENDPOINT_PATTERN) ?? []) {
      references.push({ varName, referenceType: 'cache_endpoint', value: match });
      matchedExplicit = true;
    }

    if (!matchedExplicit) {
      const upperName = varName.toUpperCase();
      if (upperName.includes('TABLE')) {
        references.push({ varName, referenceType: 'dynamodb_table', value });
      } else if (upperName.includes('BUCKET')) {
        references.push({ varName, referenceType: 's3_bucket', value });
      } else if (upperName.includes('QUEUE')) {
        references.push({ varName, referenceType: 'queue_name', value });
      } else if (upperName.includes('TOPIC')) {
        references.push({ varName, referenceType: 'topic_name', value });
      }
    }
  }

  return references;
}

export async function scanLambdaFunctions(
  options: AwsClientOptions,
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const lambda = createAwsClient(LambdaClient, options);
  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];

  const lambdas = await paginateAws(
    (marker) =>
      lambda.send(new ListFunctionsCommand({ Marker: marker }), getAwsCommandOptions(options)),
    (response) => response.Functions,
    (response) => response.NextMarker,
  );

  for (const fn of lambdas) {
    const externalId = fn.FunctionArn ?? fn.FunctionName ?? 'lambda';
    let environmentReferences: LambdaEnvReference[] = [];
    let environmentVariableNames: string[] = [];
    let eventSourceMappings: Array<Record<string, unknown>> = [];
    let functionRoleArn: string | undefined;
    let vpcId: string | undefined;
    let subnetIds: string[] = [];
    let securityGroups: string[] = [];
    let deadLetterConfig: Record<string, unknown> | undefined;
    let deadLetterTargetArn: string | undefined;

    try {
      const configuration = await lambda.send(
        new GetFunctionConfigurationCommand({
          FunctionName: fn.FunctionName ?? fn.FunctionArn,
        }),
        getAwsCommandOptions(options),
      );
      const variables = (configuration.Environment?.Variables ?? {}) as Record<string, string>;
      environmentVariableNames = Object.keys(variables);
      environmentReferences = extractLambdaEnvironmentReferences(variables);
      functionRoleArn = configuration.Role;
      vpcId = configuration.VpcConfig?.VpcId;
      subnetIds = (configuration.VpcConfig?.SubnetIds ?? []).filter((id): id is string =>
        Boolean(id),
      );
      securityGroups = (configuration.VpcConfig?.SecurityGroupIds ?? []).filter(
        (id): id is string => Boolean(id),
      );
      deadLetterTargetArn = configuration.DeadLetterConfig?.TargetArn;
      deadLetterConfig = deadLetterTargetArn ? { targetArn: deadLetterTargetArn } : undefined;
    } catch {
      warnings.push(
        `Lambda details unavailable for ${fn.FunctionName ?? externalId} in ${options.region}.`,
      );
    }

    try {
      const mappings = await paginateAws(
        (marker) =>
          lambda.send(
            new ListEventSourceMappingsCommand({
              FunctionName: fn.FunctionName ?? fn.FunctionArn,
              Marker: marker,
            }),
            getAwsCommandOptions(options),
          ),
        (response) => response.EventSourceMappings,
        (response) => response.NextMarker,
      );
      eventSourceMappings = mappings.map((mapping) => ({
        uuid: mapping.UUID,
        eventSourceArn: mapping.EventSourceArn,
        batchSize: mapping.BatchSize,
        enabled: mapping.State === 'Enabled',
        state: mapping.State,
      }));
    } catch {
      warnings.push(
        `Lambda event source mappings unavailable for ${fn.FunctionName ?? externalId} in ${options.region}.`,
      );
    }

    resources.push(
      buildResource({
        source: 'aws',
        externalId,
        name: fn.FunctionName ?? 'lambda',
        kind: 'service',
        type: 'LAMBDA',
        metadata: {
          runtime: fn.Runtime,
          handler: fn.Handler,
          functionName: fn.FunctionName,
          functionArn: fn.FunctionArn,
          roleArn: functionRoleArn,
          region: options.region,
          vpcId,
          subnetId: subnetIds[0],
          subnetIds,
          securityGroups,
          deadLetterConfig,
          deadLetterTargetArn,
          environmentVariableNames,
          environmentReferences,
          eventSourceMappings,
        },
      }),
    );
  }

  return { resources, warnings };
}
