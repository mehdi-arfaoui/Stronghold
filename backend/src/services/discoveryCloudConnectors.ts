import type { DiscoveryConnectorResult, DiscoveryCredentials, DiscoveredResource } from "./discoveryTypes.js";

import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeTagsCommand,
  DescribeRegionsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import { AutoScalingClient, DescribeAutoScalingGroupsCommand } from "@aws-sdk/client-auto-scaling";
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  ListEventSourceMappingsCommand,
} from "@aws-sdk/client-lambda";
import {
  ElastiCacheClient,
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
} from "@aws-sdk/client-elasticache";
import { DynamoDBClient, ListTablesCommand, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import { S3Client, ListBucketsCommand, GetBucketLocationCommand } from "@aws-sdk/client-s3";
import { SQSClient, ListQueuesCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import {
  SNSClient,
  ListTopicsCommand,
  GetTopicAttributesCommand,
  ListSubscriptionsByTopicCommand,
} from "@aws-sdk/client-sns";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { CostExplorerClient, GetCostAndUsageCommand } from "@aws-sdk/client-cost-explorer";
import {
  EKSClient,
  ListClustersCommand,
  DescribeClusterCommand,
  ListNodegroupsCommand,
  DescribeNodegroupCommand,
} from "@aws-sdk/client-eks";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

import { ClientSecretCredential } from "@azure/identity";
import { ResourceManagementClient } from "@azure/arm-resources";
import { ComputeManagementClient } from "@azure/arm-compute";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import { StorageManagementClient } from "@azure/arm-storage";
import { SqlManagementClient } from "@azure/arm-sql";

import { InstanceGroupManagersClient, InstancesClient, type protos } from "@google-cloud/compute";
import { ClusterManagerClient } from "@google-cloud/container";
import { SqlInstancesServiceClient } from "@google-cloud/sql";
import { appLogger as logger } from "../utils/logger.js";

function emptyResult(): DiscoveryConnectorResult {
  return { resources: [], flows: [], warnings: [] };
}

const BUSINESS_TAG_KEYS = new Set(
  [
    'Business',
    'BusinessUnit',
    'business-unit',
    'CostCenter',
    'cost-center',
    'cost_center',
    'Application',
    'app',
    'application',
    'Service',
    'service-name',
    'Environment',
    'env',
    'Owner',
    'team',
    'Team',
    'Revenue',
    'revenue-stream',
    'Criticality',
    'criticality-level',
  ].map((key) => key.toLowerCase())
);

function toBusinessTagMap(rawTags: unknown): Record<string, string> {
  const businessTags: Record<string, string> = {};

  if (Array.isArray(rawTags)) {
    for (const rawTag of rawTags) {
      if (typeof rawTag !== "string") continue;
      const [rawKey, ...rest] = rawTag.split(":");
      const key = String(rawKey || "").trim();
      const value = rest.join(":").trim();
      if (!key || !value) continue;
      if (!BUSINESS_TAG_KEYS.has(key.toLowerCase())) continue;
      businessTags[key] = value;
    }
    return businessTags;
  }

  if (rawTags && typeof rawTags === "object" && !Array.isArray(rawTags)) {
    for (const [key, value] of Object.entries(rawTags as Record<string, unknown>)) {
      if (!BUSINESS_TAG_KEYS.has(key.toLowerCase())) continue;
      if (value == null) continue;
      const normalized = String(value).trim();
      if (!normalized) continue;
      businessTags[key] = normalized;
    }
  }

  return businessTags;
}

function parseGcpInstanceGroupManagerPath(
  value: string | null | undefined,
): { zone: string; name: string } | null {
  if (!value) return null;
  const normalized = value.trim();
  const match = normalized.match(/\/zones\/([^/]+)\/instanceGroupManagers\/([^/]+)/i);
  if (!match) return null;
  const zone = match[1];
  const name = match[2];
  if (!zone || !name) return null;
  return { zone, name };
}

// Rate limiting: max concurrent region scans
const AWS_MAX_CONCURRENT_REGIONS = 5;
const AWS_CLOUDWATCH_MAX_CALLS_PER_SCAN = 20;

type AwsMetricTarget = {
  resourceExternalId: string;
  kind: "load_balancer" | "rds" | "lambda";
  namespace: string;
  metricName: string;
  dimensions: Array<{ Name: string; Value: string }>;
  unit?: string;
};

function average(values: number[]): number {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  return values.length > 0 ? sum / values.length : 0;
}

function roundMetric(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(2));
}

function extractLoadBalancerDimensionFromArn(arn: string | undefined): string | null {
  if (!arn) return null;
  const marker = "loadbalancer/";
  const index = arn.indexOf(marker);
  if (index < 0) return null;
  const dimensionValue = arn.slice(index + marker.length).trim();
  return dimensionValue.length > 0 ? dimensionValue : null;
}

async function enrichAwsResourcesWithCloudWatchMetrics(input: {
  resources: DiscoveredResource[];
  metricTargets: AwsMetricTarget[];
  region: string;
  credentialProvider: unknown;
}): Promise<void> {
  if (input.metricTargets.length === 0) return;

  const cloudWatch = new CloudWatchClient({
    region: input.region,
    credentials: input.credentialProvider as any,
  });

  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - 24 * 60 * 60 * 1000);
  const measuredAt = new Date().toISOString();
  const metricDataQueries: Array<Record<string, unknown>> = [];
  const metricTargetByQueryId = new Map<
    string,
    { target: AwsMetricTarget; stat: "avg" | "peak" }
  >();

  input.metricTargets.forEach((target, index) => {
    const avgQueryId = `m${index}a`;
    const peakQueryId = `m${index}p`;

    metricDataQueries.push({
      Id: avgQueryId,
      MetricStat: {
        Metric: {
          Namespace: target.namespace,
          MetricName: target.metricName,
          Dimensions: target.dimensions,
        },
        Period: 3600,
        Stat: target.kind === "rds" ? "Average" : "Sum",
        ...(target.unit ? { Unit: target.unit } : {}),
      },
      ReturnData: true,
    });
    metricTargetByQueryId.set(avgQueryId, { target, stat: "avg" });

    if (target.kind !== "rds") {
      metricDataQueries.push({
        Id: peakQueryId,
        MetricStat: {
          Metric: {
            Namespace: target.namespace,
            MetricName: target.metricName,
            Dimensions: target.dimensions,
          },
          Period: 3600,
          Stat: "Maximum",
          ...(target.unit ? { Unit: target.unit } : {}),
        },
        ReturnData: true,
      });
      metricTargetByQueryId.set(peakQueryId, { target, stat: "peak" });
    }
  });

  if (metricDataQueries.length === 0) return;

  const response = await cloudWatch.send(
    new GetMetricDataCommand({
      StartTime: startTime,
      EndTime: endTime,
      MetricDataQueries: metricDataQueries as any,
      ScanBy: "TimestampAscending",
    }),
  );

  const metricsByResourceId = new Map<
    string,
    {
      requestsPerHour?: number;
      peakRequestsPerHour?: number;
      connectionsAvg?: number;
    }
  >();

  for (const result of response.MetricDataResults || []) {
    if (!result.Id) continue;
    const descriptor = metricTargetByQueryId.get(result.Id);
    if (!descriptor) continue;
    const values = (result.Values || [])
      .map((value: unknown) => Number(value))
      .filter((value): value is number => Number.isFinite(value));
    if (values.length === 0) continue;

    const current = metricsByResourceId.get(descriptor.target.resourceExternalId) || {};
    if (descriptor.target.kind === "rds") {
      current.connectionsAvg = roundMetric(average(values));
    } else if (descriptor.stat === "peak") {
      current.peakRequestsPerHour = roundMetric(Math.max(...values));
    } else {
      current.requestsPerHour = roundMetric(average(values));
    }
    metricsByResourceId.set(descriptor.target.resourceExternalId, current);
  }

  for (const resource of input.resources) {
    const metrics = metricsByResourceId.get(resource.externalId);
    if (!metrics) continue;
    resource.metadata = {
      ...(resource.metadata || {}),
      metrics: {
        ...(resource.metadata?.metrics && typeof resource.metadata.metrics === "object"
          ? (resource.metadata.metrics as Record<string, unknown>)
          : {}),
        ...metrics,
        source: "cloudwatch",
        measuredAt,
      },
    };
  }
}

function startOfMonth(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1, 0, 0, 0));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalizeAwsResourceId(value: string): string {
  return value.trim().toLowerCase();
}

function matchResourceToCostId(resource: DiscoveredResource, costResourceId: string): boolean {
  const normalizedCostId = normalizeAwsResourceId(costResourceId);
  const candidates = [
    resource.externalId,
    resource.name,
    resource.ip || "",
  ]
    .filter(Boolean)
    .map((candidate) => normalizeAwsResourceId(String(candidate)));

  return candidates.some(
    (candidate) =>
      normalizedCostId === candidate ||
      normalizedCostId.includes(candidate) ||
      candidate.includes(normalizedCostId),
  );
}

async function enrichAwsResourcesWithCostExplorer(input: {
  resources: DiscoveredResource[];
  credentials: DiscoveryCredentials;
}): Promise<void> {
  if (!input.credentials.aws?.accessKeyId && !input.credentials.aws?.roleArn) return;
  if (input.resources.length === 0) return;

  const credentialProvider = input.credentials.aws.roleArn
    ? fromTemporaryCredentials({
        params: {
          RoleArn: input.credentials.aws.roleArn,
          RoleSessionName: "stronghold-discovery-cost-explorer",
          ExternalId: input.credentials.aws.externalId,
        },
        clientConfig: { region: "us-east-1" },
      })
    : {
        accessKeyId: input.credentials.aws.accessKeyId,
        secretAccessKey: input.credentials.aws.secretAccessKey,
        sessionToken: input.credentials.aws.sessionToken,
      };

  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const previousMonthStart = startOfMonth(
    new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - 1, 1)),
  );

  const costExplorer = new CostExplorerClient({
    region: "us-east-1",
    credentials: credentialProvider as any,
  });

  const response = await costExplorer.send(
    new GetCostAndUsageCommand({
      TimePeriod: {
        Start: toIsoDate(previousMonthStart),
        End: toIsoDate(currentMonthStart),
      },
      Granularity: "MONTHLY",
      Metrics: ["UnblendedCost"],
      GroupBy: [{ Type: "DIMENSION", Key: "RESOURCE_ID" }],
      Filter: {
        Dimensions: {
          Key: "SERVICE",
          Values: [
            "Amazon Relational Database Service",
            "Amazon Elastic Compute Cloud - Compute",
            "AWS Lambda",
            "Amazon ElastiCache",
            "Amazon Elastic Load Balancing",
          ],
        },
      },
    }),
  );

  const monthLabel = previousMonthStart.toISOString().slice(0, 7);
  const costByResourceId = new Map<string, number>();
  for (const bucket of response.ResultsByTime || []) {
    for (const group of bucket.Groups || []) {
      const resourceId = group.Keys?.[0];
      const amount = Number(group.Metrics?.UnblendedCost?.Amount || 0);
      if (!resourceId || !Number.isFinite(amount) || amount <= 0) continue;
      costByResourceId.set(resourceId, amount);
    }
  }

  if (costByResourceId.size === 0) return;

  for (const resource of input.resources) {
    let monthlyTotal = 0;
    for (const [resourceId, amount] of costByResourceId.entries()) {
      if (!matchResourceToCostId(resource, resourceId)) continue;
      monthlyTotal = amount;
      break;
    }
    if (monthlyTotal <= 0) continue;

    const dailyAvg = monthlyTotal / 30;
    resource.metadata = {
      ...(resource.metadata || {}),
      cloudCost: {
        dailyAvgUSD: roundMetric(dailyAvg),
        monthlyTotalUSD: roundMetric(monthlyTotal),
        source: "aws_cost_explorer",
        period: monthLabel,
      },
    };
  }
}

/**
 * Fetch all available AWS regions using EC2 DescribeRegions API.
 */
export async function getAllAwsRegions(
  credentials: DiscoveryCredentials
): Promise<string[]> {
  if (!credentials.aws?.accessKeyId && !credentials.aws?.roleArn) {
    return [];
  }

  const credentialProvider = credentials.aws.roleArn
    ? fromTemporaryCredentials({
        params: {
          RoleArn: credentials.aws.roleArn,
          RoleSessionName: "stronghold-discovery-regions",
          ExternalId: credentials.aws.externalId,
        },
        clientConfig: { region: "us-east-1" },
      })
    : {
        accessKeyId: credentials.aws.accessKeyId,
        secretAccessKey: credentials.aws.secretAccessKey,
        sessionToken: credentials.aws.sessionToken,
      };

  const ec2 = new EC2Client({ region: "us-east-1", credentials: credentialProvider as any });
  const { Regions } = await ec2.send(new DescribeRegionsCommand({}));

  return Regions?.map((r) => r.RegionName).filter((name): name is string => !!name) || [];
}

/**
 * Process items in batches with concurrency limit.
 */
async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(batch.map(processor));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Paginates an AWS SDK call and concatenates items from every page.
 */
export async function paginateAws<TResponse, TItem>(
  callFn: (nextToken?: string) => Promise<TResponse>,
  extractItems: (response: TResponse) => TItem[] | undefined,
  getNextToken: (response: TResponse) => string | undefined | null,
  serviceName = "AWS",
): Promise<TItem[]> {
  const allItems: TItem[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;

  do {
    const response = await callFn(nextToken);
    const items = extractItems(response) || [];
    allItems.push(...items);
    pageCount += 1;

    if (pageCount > 1) {
      logger.debug(`[AWS] ${serviceName}: page ${pageCount}, ${allItems.length} items cumules`);
    }

    nextToken = getNextToken(response) ?? undefined;
  } while (nextToken);

  return allItems;
}

function buildResource(input: Partial<DiscoveredResource> & { source: string; externalId: string }) {
  return {
    name: input.name || input.externalId,
    kind: input.kind || "infra",
    type: input.type || "CLOUD",
    ...input,
  } satisfies DiscoveredResource;
}

function normalizeS3Region(locationConstraint: string | null | undefined): string {
  if (!locationConstraint) return "us-east-1";
  if (locationConstraint === "EU") return "eu-west-1";
  return locationConstraint;
}

const LAMBDA_ENV_ARN_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[A-Za-z0-9\-_/.:]+/g;
const LAMBDA_ENV_SQS_URL_PATTERN = /https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9\-_]+/g;
const LAMBDA_ENV_RDS_ENDPOINT_PATTERN = /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.[A-Za-z0-9-]+\.rds\.amazonaws\.com/g;
const LAMBDA_ENV_CACHE_ENDPOINT_PATTERN = /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.cache\.amazonaws\.com/g;

type LambdaEnvReference = {
  varName: string;
  referenceType: string;
  value: string;
};

function extractLambdaEnvironmentReferences(
  envVars: Record<string, string>,
): LambdaEnvReference[] {
  const references: LambdaEnvReference[] = [];

  for (const [varName, rawValue] of Object.entries(envVars)) {
    if (typeof rawValue !== "string") continue;
    const value = rawValue.trim();
    if (!value) continue;
    let matchedExplicitReference = false;

    for (const match of value.match(LAMBDA_ENV_ARN_PATTERN) || []) {
      references.push({ varName, referenceType: "arn", value: match });
      matchedExplicitReference = true;
    }

    for (const match of value.match(LAMBDA_ENV_SQS_URL_PATTERN) || []) {
      references.push({ varName, referenceType: "sqs_url", value: match });
      matchedExplicitReference = true;
    }

    for (const match of value.match(LAMBDA_ENV_RDS_ENDPOINT_PATTERN) || []) {
      references.push({ varName, referenceType: "rds_endpoint", value: match });
      matchedExplicitReference = true;
    }

    for (const match of value.match(LAMBDA_ENV_CACHE_ENDPOINT_PATTERN) || []) {
      references.push({ varName, referenceType: "cache_endpoint", value: match });
      matchedExplicitReference = true;
    }

    const upperName = varName.toUpperCase();
    if (!matchedExplicitReference) {
      if (upperName.includes("TABLE")) {
        references.push({ varName, referenceType: "dynamodb_table", value });
      } else if (upperName.includes("BUCKET")) {
        references.push({ varName, referenceType: "s3_bucket", value });
      } else if (upperName.includes("QUEUE")) {
        references.push({ varName, referenceType: "queue_name", value });
      } else if (upperName.includes("TOPIC")) {
        references.push({ varName, referenceType: "topic_name", value });
      }
    }
  }

  return references;
}

/**
 * Scan a single AWS region for resources.
 * @internal
 */
async function scanAwsRegion(
  region: string,
  credentials: DiscoveryCredentials,
  options?: {
    collectCloudWatchMetrics?: boolean;
    includeGlobalServices?: boolean;
  },
): Promise<{ resources: DiscoveredResource[]; warnings: string[] }> {
  const credentialProvider = credentials.aws?.roleArn
    ? fromTemporaryCredentials({
        params: {
          RoleArn: credentials.aws.roleArn,
          RoleSessionName: "stronghold-discovery",
          ExternalId: credentials.aws.externalId,
        },
        clientConfig: { region },
      })
    : {
        accessKeyId: credentials.aws?.accessKeyId,
        secretAccessKey: credentials.aws?.secretAccessKey,
        sessionToken: credentials.aws?.sessionToken,
      };

  const ec2 = new EC2Client({ region, credentials: credentialProvider as any });
  const rds = new RDSClient({ region, credentials: credentialProvider as any });
  const lambda = new LambdaClient({ region, credentials: credentialProvider as any });
  const asg = new AutoScalingClient({ region, credentials: credentialProvider as any });
  const elb = new ElasticLoadBalancingV2Client({ region, credentials: credentialProvider as any });
  const eks = new EKSClient({ region, credentials: credentialProvider as any });
  const elasticache = new ElastiCacheClient({ region, credentials: credentialProvider as any });
  const dynamodb = new DynamoDBClient({ region, credentials: credentialProvider as any });
  const sqs = new SQSClient({ region, credentials: credentialProvider as any });
  const sns = new SNSClient({ region, credentials: credentialProvider as any });

  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const metricTargets: AwsMetricTarget[] = [];

  const extractDeadLetterArnFromRedrivePolicy = (rawPolicy: string | undefined): string | undefined => {
    if (!rawPolicy || rawPolicy.trim().length === 0) return undefined;
    try {
      const parsed = JSON.parse(rawPolicy) as Record<string, unknown>;
      return typeof parsed.deadLetterTargetArn === "string" ? parsed.deadLetterTargetArn : undefined;
    } catch {
      return undefined;
    }
  };

  const extractMaxReceiveCountFromRedrivePolicy = (rawPolicy: string | undefined): number | undefined => {
    if (!rawPolicy || rawPolicy.trim().length === 0) return undefined;
    try {
      const parsed = JSON.parse(rawPolicy) as Record<string, unknown>;
      const value = Number(parsed.maxReceiveCount);
      return Number.isFinite(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };

  // EC2 Instances
  const reservations = await paginateAws(
    (nextToken) => ec2.send(new DescribeInstancesCommand({ NextToken: nextToken })),
    (response) => response.Reservations,
    (response) => response.NextToken,
    "EC2",
  );
  reservations.forEach((reservation) => {
    reservation.Instances?.forEach((instance) => {
      const awsTags = Object.fromEntries(
        (instance.Tags || [])
          .filter((tag): tag is { Key: string; Value?: string } => Boolean(tag?.Key))
          .map((tag) => [tag.Key, tag.Value ?? ""])
      );
      const nameFromTag = typeof awsTags.Name === "string" && awsTags.Name.trim().length > 0
        ? awsTags.Name.trim()
        : null;

      resources.push(
        buildResource({
          source: "aws",
          externalId: instance.InstanceId || "ec2",
          name: nameFromTag || instance.InstanceId || "ec2",
          kind: "infra",
          type: "EC2",
          ip: instance.PrivateIpAddress || null,
          hostname: instance.PrivateDnsName || null,
          tags: Object.entries(awsTags).map(([key, value]) => `${key}:${value}`),
          metadata: {
            state: instance.State?.Name,
            instanceType: instance.InstanceType,
            region,
            availabilityZone: instance.Placement?.AvailabilityZone,
            subnetId: instance.SubnetId,
            vpcId: instance.VpcId,
            securityGroups: (instance.SecurityGroups || [])
              .map((group) => group.GroupId)
              .filter((groupId): groupId is string => Boolean(groupId)),
            architecture: instance.Architecture,
            platformDetails: instance.PlatformDetails,
            displayName: nameFromTag || instance.InstanceId || "ec2",
            awsTags,
          },
        })
      );
    });
  });

  // EC2 Tags
  const tags = await ec2.send(new DescribeTagsCommand({}));
  if (tags.Tags) {
    tags.Tags.forEach((tag) => {
      if (!tag.ResourceId || !tag.Key) return;
      const resource = resources.find((item) => item.externalId === tag.ResourceId);
      if (!resource) return;
      const existing = new Set(resource.tags || []);
      existing.add(`${tag.Key}:${tag.Value ?? ""}`);
      resource.tags = Array.from(existing);
      resource.metadata = {
        ...(resource.metadata || {}),
        awsTags: {
          ...((resource.metadata as Record<string, unknown> | null)?.awsTags as Record<string, string> | undefined),
          [tag.Key]: tag.Value ?? "",
        },
      };

      if (tag.Key === "Name") {
        const taggedName = (tag.Value || "").trim();
        if (taggedName.length > 0) {
          const currentName = String(resource.name || "").trim();
          if (
            currentName.length === 0 ||
            currentName === resource.externalId ||
            currentName.startsWith("i-")
          ) {
            resource.name = taggedName;
          }
          resource.metadata = {
            ...(resource.metadata || {}),
            displayName: taggedName,
          };
        }
      }
    });
  }

  // Persist structured business tags in metadata for downstream enrichment.
  for (const resource of resources) {
    const businessTags = toBusinessTagMap(resource.tags || []);
    const metadata = (resource.metadata && typeof resource.metadata === "object"
      ? (resource.metadata as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const awsTags =
      metadata.awsTags && typeof metadata.awsTags === "object" && !Array.isArray(metadata.awsTags)
        ? (metadata.awsTags as Record<string, string>)
        : {};
    const autoScalingGroupName =
      typeof awsTags["aws:autoscaling:groupName"] === "string"
        ? awsTags["aws:autoscaling:groupName"]
        : undefined;
    const nameFromTag = typeof awsTags.Name === "string" ? awsTags.Name.trim() : "";
    if (nameFromTag.length > 0 && (!resource.name || resource.name === resource.externalId || resource.name.startsWith("i-"))) {
      resource.name = nameFromTag;
    }
    resource.metadata = {
      ...metadata,
      ...(nameFromTag.length > 0 ? { displayName: nameFromTag } : {}),
      ...(autoScalingGroupName ? { autoScalingGroupName } : {}),
      ...(Object.keys(businessTags).length > 0 ? { businessTags } : {}),
    };
  }

  // RDS Instances
  const dbInstances = await paginateAws(
    (marker) => rds.send(new DescribeDBInstancesCommand({ Marker: marker })),
    (response) => response.DBInstances,
    (response) => response.Marker,
    "RDS",
  );
  dbInstances.forEach((db) => {
    const dbIdentifier = db.DBInstanceIdentifier || "rds";
    resources.push(
      buildResource({
        source: "aws",
        externalId: dbIdentifier,
        name: dbIdentifier,
        kind: "infra",
        type: "RDS",
        ip: db.Endpoint?.Address || null,
        metadata: {
          dbIdentifier,
          dbArn: db.DBInstanceArn,
          engine: db.Engine,
          dbInstanceClass: db.DBInstanceClass,
          instanceClass: db.DBInstanceClass,
          status: db.DBInstanceStatus,
          region,
          multiAz: Boolean(db.MultiAZ),
          multi_az: Boolean(db.MultiAZ),
          isMultiAZ: Boolean(db.MultiAZ),
          readReplicaCount: db.ReadReplicaDBInstanceIdentifiers?.length || 0,
          replicaCount: db.ReadReplicaDBInstanceIdentifiers?.length || 0,
          publiclyAccessible: db.PubliclyAccessible,
          availabilityZone: db.AvailabilityZone,
          endpointAddress: db.Endpoint?.Address,
          endpointPort: db.Endpoint?.Port,
          subnetId: db.DBSubnetGroup?.Subnets?.[0]?.SubnetIdentifier,
          vpcId: db.DBSubnetGroup?.VpcId,
          securityGroups: (db.VpcSecurityGroups || [])
            .map((group) => group.VpcSecurityGroupId)
            .filter((groupId): groupId is string => Boolean(groupId)),
          displayName: dbIdentifier,
        },
      })
    );

    if (db.DBInstanceIdentifier) {
      metricTargets.push({
        resourceExternalId: dbIdentifier,
        kind: "rds",
        namespace: "AWS/RDS",
        metricName: "DatabaseConnections",
        dimensions: [{ Name: "DBInstanceIdentifier", Value: db.DBInstanceIdentifier }],
      });
    }
  });

  // Lambda Functions
  try {
    const lambdas = await paginateAws(
      (marker) => lambda.send(new ListFunctionsCommand({ Marker: marker })),
      (response) => response.Functions,
      (response) => response.NextMarker,
      "Lambda Functions",
    );
    for (const fn of lambdas) {
      const functionExternalId = fn.FunctionArn || fn.FunctionName || "lambda";
      let environmentReferences: LambdaEnvReference[] = [];
      let environmentVariableNames: string[] = [];
      let eventSourceMappings: Array<Record<string, unknown>> = [];
      let functionRoleArn: string | undefined;
      let vpcId: string | undefined;
      let subnetIds: string[] = [];
      let securityGroups: string[] = [];

      try {
        const details = await lambda.send(
          new GetFunctionCommand({
            FunctionName: fn.FunctionName || fn.FunctionArn,
          }),
        );
        const variables = (details.Configuration?.Environment?.Variables || {}) as Record<string, string>;
        environmentVariableNames = Object.keys(variables);
        environmentReferences = extractLambdaEnvironmentReferences(variables);
        functionRoleArn = details.Configuration?.Role;
        vpcId = details.Configuration?.VpcConfig?.VpcId;
        subnetIds = (details.Configuration?.VpcConfig?.SubnetIds || []).filter(
          (subnetId): subnetId is string => Boolean(subnetId),
        );
        securityGroups = (details.Configuration?.VpcConfig?.SecurityGroupIds || []).filter(
          (securityGroupId): securityGroupId is string => Boolean(securityGroupId),
        );
      } catch {
        warnings.push(
          `Lambda details unavailable for ${fn.FunctionName || functionExternalId} in ${region}.`,
        );
      }

      try {
        const mappings = await paginateAws(
          (marker) =>
            lambda.send(
              new ListEventSourceMappingsCommand({
                FunctionName: fn.FunctionName || fn.FunctionArn,
                Marker: marker,
              }),
            ),
          (response) => response.EventSourceMappings,
          (response) => response.NextMarker,
          "Lambda EventSourceMappings",
        );
        eventSourceMappings = mappings.map((mapping) => ({
          uuid: mapping.UUID,
          eventSourceArn: mapping.EventSourceArn,
          batchSize: mapping.BatchSize,
          enabled: mapping.State === "Enabled",
          state: mapping.State,
        }));
      } catch {
        warnings.push(
          `Lambda event source mappings unavailable for ${fn.FunctionName || functionExternalId} in ${region}.`,
        );
      }

      resources.push(
        buildResource({
          source: "aws",
          externalId: functionExternalId,
          name: fn.FunctionName || "lambda",
          kind: "service",
          type: "LAMBDA",
          metadata: {
            runtime: fn.Runtime,
            handler: fn.Handler,
            functionName: fn.FunctionName,
            functionArn: fn.FunctionArn,
            roleArn: functionRoleArn,
            region,
            vpcId,
            subnetId: subnetIds[0],
            subnetIds,
            securityGroups,
            environmentVariableNames,
            environmentReferences,
            eventSourceMappings,
          },
        }),
      );

      if (fn.FunctionName) {
        metricTargets.push({
          resourceExternalId: functionExternalId,
          kind: "lambda",
          namespace: "AWS/Lambda",
          metricName: "Invocations",
          dimensions: [{ Name: "FunctionName", Value: fn.FunctionName }],
        });
      }
    }
  } catch {
    warnings.push(`Lambda scan skipped in ${region} (insufficient permissions or unavailable API).`);
  }

  // ElastiCache Clusters
  try {
    const replicationGroups = await paginateAws(
      (marker) => elasticache.send(new DescribeReplicationGroupsCommand({ Marker: marker })),
      (response) => response.ReplicationGroups,
      (response) => response.Marker,
      "ElastiCache ReplicationGroups",
    );
    const memberClusterCountByReplicationGroup = new Map<string, number>();
    for (const group of replicationGroups) {
      if (!group.ReplicationGroupId) continue;
      memberClusterCountByReplicationGroup.set(
        group.ReplicationGroupId,
        group.MemberClusters?.length || 0
      );
    }

    const cacheClusters = await paginateAws(
      (marker) =>
        elasticache.send(
          new DescribeCacheClustersCommand({
            ShowCacheNodeInfo: true,
            Marker: marker,
          }),
        ),
      (response) => response.CacheClusters,
      (response) => response.Marker,
      "ElastiCache CacheClusters",
    );
    for (const cluster of cacheClusters) {
      const clusterId = cluster.CacheClusterId || "elasticache";
      const replicationGroupId = cluster.ReplicationGroupId;
      const replicationGroupClusterCount = replicationGroupId
        ? memberClusterCountByReplicationGroup.get(replicationGroupId) || 0
        : 0;
      const replicaCountFromGroup = replicationGroupClusterCount > 0 ? Math.max(0, replicationGroupClusterCount - 1) : 0;

      resources.push(
        buildResource({
          source: "aws",
          externalId: cluster.ARN || clusterId,
          name: clusterId,
          kind: "infra",
          type: "ELASTICACHE",
          metadata: {
            region,
            cacheClusterId: clusterId,
            cacheClusterArn: cluster.ARN,
            engine: cluster.Engine,
            status: cluster.CacheClusterStatus,
            cacheNodeType: cluster.CacheNodeType,
            numCacheNodes: cluster.NumCacheNodes ?? undefined,
            num_cache_nodes: cluster.NumCacheNodes ?? undefined,
            replicationGroupId: replicationGroupId ?? undefined,
            replicationGroup: replicationGroupId ?? undefined,
            replicaCount: replicaCountFromGroup,
            availabilityZone: cluster.PreferredAvailabilityZone,
            subnetGroup: cluster.CacheSubnetGroupName,
            securityGroups: (cluster.SecurityGroups || [])
              .map((group) => group.SecurityGroupId)
              .filter((groupId): groupId is string => Boolean(groupId)),
            endpointAddress:
              cluster.ConfigurationEndpoint?.Address || cluster.CacheNodes?.[0]?.Endpoint?.Address,
            endpointPort:
              cluster.ConfigurationEndpoint?.Port || cluster.CacheNodes?.[0]?.Endpoint?.Port,
            configurationEndpoint: cluster.ConfigurationEndpoint?.Address,
            primaryEndpoint: cluster.CacheNodes?.[0]?.Endpoint?.Address,
            displayName: clusterId,
          },
        })
      );
    }
  } catch {
    warnings.push(`ElastiCache scan skipped in ${region} (insufficient permissions or unavailable API).`);
  }

  // DynamoDB Tables
  try {
    const tables = await paginateAws(
      (exclusiveStartTableName) =>
        dynamodb.send(new ListTablesCommand({ ExclusiveStartTableName: exclusiveStartTableName })),
      (response) => response.TableNames,
      (response) => response.LastEvaluatedTableName,
      "DynamoDB Tables",
    );
    for (const tableName of tables) {
      const details = await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
      const table = details.Table;
      if (!table) continue;
      const replicaCount = table.Replicas?.length || 0;

      resources.push(
        buildResource({
          source: "aws",
          externalId: table.TableArn || table.TableId || table.TableName || tableName,
          name: table.TableName || tableName,
          kind: "infra",
          type: "DYNAMODB",
          metadata: {
            region,
            tableName: table.TableName,
            tableArn: table.TableArn,
            status: table.TableStatus,
            billingMode: table.BillingModeSummary?.BillingMode,
            itemCount: table.ItemCount,
            sizeBytes: table.TableSizeBytes,
            streamArn: table.LatestStreamArn,
            replicaCount,
            globalTable: replicaCount > 0,
            displayName: table.TableName || tableName,
          },
        })
      );
    }
  } catch {
    warnings.push(`DynamoDB scan skipped in ${region} (insufficient permissions or unavailable API).`);
  }

  // SQS Queues
  try {
    const queueList = await paginateAws(
      (nextToken) => sqs.send(new ListQueuesCommand({ NextToken: nextToken })),
      (response) => response.QueueUrls,
      (response) => response.NextToken,
      "SQS Queues",
    );
    for (const queueUrl of queueList) {
      const queueAttributes = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: queueUrl,
          AttributeNames: ["All"],
        })
      );
      const attrs = queueAttributes.Attributes || {};
      const queueArn = attrs.QueueArn || queueUrl;
      const queueName = queueArn.split(":").pop() || queueUrl.split("/").pop() || "queue";
      const redrivePolicy = attrs.RedrivePolicy;
      const deadLetterTargetArn = extractDeadLetterArnFromRedrivePolicy(redrivePolicy);
      const maxReceiveCount = extractMaxReceiveCountFromRedrivePolicy(redrivePolicy);

      resources.push(
        buildResource({
          source: "aws",
          externalId: queueArn,
          name: queueName,
          kind: "infra",
          type: "SQS_QUEUE",
          metadata: {
            region,
            queueUrl,
            queueArn,
            queueName,
            fifoQueue: attrs.FifoQueue === "true",
            visibilityTimeout: attrs.VisibilityTimeout ? Number(attrs.VisibilityTimeout) : undefined,
            messageRetentionSeconds: attrs.MessageRetentionPeriod ? Number(attrs.MessageRetentionPeriod) : undefined,
            kmsMasterKeyId: attrs.KmsMasterKeyId || undefined,
            redrivePolicy: redrivePolicy || undefined,
            deadLetterTargetArn,
            dlqArn: deadLetterTargetArn,
            maxReceiveCount,
            displayName: queueName,
          },
        })
      );
    }
  } catch {
    warnings.push(`SQS scan skipped in ${region} (insufficient permissions or unavailable API).`);
  }

  // SNS Topics
  try {
    const topicList = await paginateAws(
      (nextToken) => sns.send(new ListTopicsCommand({ NextToken: nextToken })),
      (response) => response.Topics,
      (response) => response.NextToken,
      "SNS Topics",
    );
    for (const topic of topicList) {
      if (!topic.TopicArn) continue;
      const attributes = await sns.send(new GetTopicAttributesCommand({ TopicArn: topic.TopicArn }));
      const attrs = attributes.Attributes || {};
      const topicName = topic.TopicArn.split(":").pop() || "topic";
      let subscriptions: Array<{ protocol: string; endpoint: string }> = [];

      try {
        const subscriptionsResult = await paginateAws(
          (nextToken) =>
            sns.send(
              new ListSubscriptionsByTopicCommand({
                TopicArn: topic.TopicArn,
                NextToken: nextToken,
              }),
            ),
          (response) => response.Subscriptions,
          (response) => response.NextToken,
          "SNS SubscriptionsByTopic",
        );
        subscriptions = subscriptionsResult
          .map((subscription) => ({
            protocol: String(subscription.Protocol || "").toLowerCase(),
            endpoint: String(subscription.Endpoint || ""),
          }))
          .filter(
            (subscription) =>
              Boolean(subscription.endpoint) &&
              (subscription.protocol === "lambda" || subscription.protocol === "sqs"),
          );
      } catch {
        warnings.push(`SNS subscriptions unavailable for topic ${topicName} in ${region}.`);
      }

      resources.push(
        buildResource({
          source: "aws",
          externalId: topic.TopicArn,
          name: topicName,
          kind: "infra",
          type: "SNS_TOPIC",
          metadata: {
            region,
            topicArn: topic.TopicArn,
            topicName,
            fifoTopic: attrs.FifoTopic === "true",
            kmsMasterKeyId: attrs.KmsMasterKeyId || undefined,
            subscriptionsConfirmed: attrs.SubscriptionsConfirmed
              ? Number(attrs.SubscriptionsConfirmed)
              : undefined,
            subscriptionsPending: attrs.SubscriptionsPending
              ? Number(attrs.SubscriptionsPending)
              : undefined,
            subscriptionsDeleted: attrs.SubscriptionsDeleted
              ? Number(attrs.SubscriptionsDeleted)
              : undefined,
            subscriptions,
            displayName: topicName,
          },
        })
      );
    }
  } catch {
    warnings.push(`SNS scan skipped in ${region} (insufficient permissions or unavailable API).`);
  }

  // S3 Buckets (global inventory, queried once per full scan)
  if (options?.includeGlobalServices) {
    try {
      const s3 = new S3Client({ region: "us-east-1", credentials: credentialProvider as any });
      const buckets = await s3.send(new ListBucketsCommand({}));

      for (const bucket of buckets.Buckets || []) {
        if (!bucket.Name) continue;
        const bucketName = bucket.Name;

        let bucketRegion = "us-east-1";
        try {
          const location = await s3.send(new GetBucketLocationCommand({ Bucket: bucketName }));
          bucketRegion = normalizeS3Region(location.LocationConstraint as string | undefined);
        } catch {
          // Keep default us-east-1 when bucket location is unavailable.
        }

        resources.push(
          buildResource({
            source: "aws",
            externalId: `arn:aws:s3:::${bucketName}`,
            name: bucketName,
            kind: "infra",
            type: "S3_BUCKET",
            metadata: {
              region: bucketRegion,
              bucketName,
              bucketArn: `arn:aws:s3:::${bucketName}`,
              creationDate: bucket.CreationDate?.toISOString(),
              displayName: bucketName,
            },
          })
        );
      }
    } catch {
      warnings.push("S3 scan skipped (insufficient permissions or unavailable API).");
    }
  }

  // Auto Scaling Groups
  const groups = await paginateAws(
    (nextToken) => asg.send(new DescribeAutoScalingGroupsCommand({ NextToken: nextToken })),
    (response) => response.AutoScalingGroups,
    (response) => response.NextToken,
    "AutoScaling Groups",
  );
  groups.forEach((group) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: group.AutoScalingGroupARN || group.AutoScalingGroupName || "asg",
        name: group.AutoScalingGroupName || "asg",
        kind: "infra",
        type: "ASG",
        metadata: { minSize: group.MinSize, maxSize: group.MaxSize, region },
      })
    );
  });

  // Load Balancers
  const loadBalancers = await paginateAws(
    (marker) => elb.send(new DescribeLoadBalancersCommand({ Marker: marker })),
    (response) => response.LoadBalancers,
    (response) => response.NextMarker,
    "ELBv2 LoadBalancers",
  );
  loadBalancers.forEach((lb) => {
    const lbExternalId = lb.LoadBalancerArn || lb.LoadBalancerName || "elb";
    resources.push(
      buildResource({
        source: "aws",
        externalId: lbExternalId,
        name: lb.LoadBalancerName || "elb",
        kind: "infra",
        type: "ELB",
        ip: lb.DNSName || null,
        metadata: { scheme: lb.Scheme, type: lb.Type, region },
      })
    );

    const lbDimension = extractLoadBalancerDimensionFromArn(lb.LoadBalancerArn);
    const lbType = String(lb.Type || "").toLowerCase();
    const namespace =
      lbType === "application"
        ? "AWS/ApplicationELB"
        : lbType === "network"
          ? "AWS/NetworkELB"
          : null;

    if (lbDimension && namespace) {
      metricTargets.push({
        resourceExternalId: lbExternalId,
        kind: "load_balancer",
        namespace,
        metricName: "RequestCount",
        dimensions: [{ Name: "LoadBalancer", Value: lbDimension }],
      });
    }
  });

  // EKS Clusters
  const clusterList = await paginateAws(
    (nextToken) => eks.send(new ListClustersCommand({ nextToken })),
    (response) => response.clusters,
    (response) => response.nextToken,
    "EKS Clusters",
  );
  for (const clusterName of clusterList) {
    const clusterDetails = await eks.send(new DescribeClusterCommand({ name: clusterName }));
    const cluster = clusterDetails.cluster;
    if (!cluster) continue;

    resources.push(
      buildResource({
        source: "aws",
        externalId: cluster.arn || clusterName,
        name: clusterName,
        kind: "infra",
        type: "EKS",
        metadata: {
          region,
          version: cluster.version,
          status: cluster.status,
          endpoint: cluster.endpoint,
          platformVersion: cluster.platformVersion,
          vpcId: cluster.resourcesVpcConfig?.vpcId,
        },
      })
    );

    // List node groups for this cluster
    const nodeGroupList = await eks.send(new ListNodegroupsCommand({ clusterName }));
    for (const nodeGroupName of nodeGroupList.nodegroups || []) {
      const nodeGroupDetails = await eks.send(
        new DescribeNodegroupCommand({ clusterName, nodegroupName: nodeGroupName })
      );
      const nodeGroup = nodeGroupDetails.nodegroup;
      if (!nodeGroup) continue;

      resources.push(
        buildResource({
          source: "aws",
          externalId: nodeGroup.nodegroupArn || `${clusterName}/${nodeGroupName}`,
          name: `${clusterName}/${nodeGroupName}`,
          kind: "infra",
          type: "EKS_NODEGROUP",
          metadata: {
            region,
            clusterName,
            status: nodeGroup.status,
            capacityType: nodeGroup.capacityType,
            instanceTypes: nodeGroup.instanceTypes,
            desiredSize: nodeGroup.scalingConfig?.desiredSize,
            minSize: nodeGroup.scalingConfig?.minSize,
            maxSize: nodeGroup.scalingConfig?.maxSize,
          },
        })
      );
    }
  }

  // VPCs
  const vpcs = await paginateAws(
    (nextToken) => ec2.send(new DescribeVpcsCommand({ NextToken: nextToken })),
    (response) => response.Vpcs,
    (response) => response.NextToken,
    "EC2 VPCs",
  );
  vpcs.forEach((vpc) => {
    const vpcName = vpc.Tags?.find((t) => t.Key === "Name")?.Value || vpc.VpcId;
    resources.push(
      buildResource({
        source: "aws",
        externalId: vpc.VpcId || "vpc",
        name: vpcName || "vpc",
        kind: "infra",
        type: "VPC",
        metadata: {
          region,
          cidrBlock: vpc.CidrBlock,
          state: vpc.State,
          isDefault: vpc.IsDefault,
          dhcpOptionsId: vpc.DhcpOptionsId,
        },
      })
    );
  });

  // Subnets
  const subnets = await paginateAws(
    (nextToken) => ec2.send(new DescribeSubnetsCommand({ NextToken: nextToken })),
    (response) => response.Subnets,
    (response) => response.NextToken,
    "EC2 Subnets",
  );
  subnets.forEach((subnet) => {
    const subnetName = subnet.Tags?.find((t) => t.Key === "Name")?.Value || subnet.SubnetId;
    resources.push(
      buildResource({
        source: "aws",
        externalId: subnet.SubnetId || "subnet",
        name: subnetName || "subnet",
        kind: "infra",
        type: "SUBNET",
        metadata: {
          region,
          vpcId: subnet.VpcId,
          cidrBlock: subnet.CidrBlock,
          availabilityZone: subnet.AvailabilityZone,
          availableIpAddressCount: subnet.AvailableIpAddressCount,
          mapPublicIpOnLaunch: subnet.MapPublicIpOnLaunch,
          defaultForAz: subnet.DefaultForAz,
        },
      })
    );
  });

  // Security Groups
  const securityGroups = await paginateAws(
    (nextToken) => ec2.send(new DescribeSecurityGroupsCommand({ NextToken: nextToken })),
    (response) => response.SecurityGroups,
    (response) => response.NextToken,
    "EC2 SecurityGroups",
  );
  securityGroups.forEach((sg) => {
    resources.push(
      buildResource({
        source: "aws",
        externalId: sg.GroupId || "sg",
        name: sg.GroupName || "sg",
        kind: "infra",
        type: "SECURITY_GROUP",
        metadata: {
          region,
          groupId: sg.GroupId,
          vpcId: sg.VpcId,
          description: sg.Description,
          inboundRulesCount: sg.IpPermissions?.length || 0,
          outboundRulesCount: sg.IpPermissionsEgress?.length || 0,
          inboundRules: sg.IpPermissions?.map((rule) => ({
            protocol: rule.IpProtocol,
            fromPort: rule.FromPort,
            toPort: rule.ToPort,
            sources: [
              ...(rule.IpRanges?.map((r) => r.CidrIp) || []),
              ...(rule.Ipv6Ranges?.map((r) => r.CidrIpv6) || []),
              ...(rule.UserIdGroupPairs?.map((g) => g.GroupId) || []),
            ],
          })),
        },
      })
    );
  });

  if (options?.collectCloudWatchMetrics && metricTargets.length > 0) {
    try {
      // Keep scan latency bounded: sample up to 20 resources for metrics enrichment per region.
      const sampledTargets = metricTargets.slice(0, 20);
      await enrichAwsResourcesWithCloudWatchMetrics({
        resources,
        metricTargets: sampledTargets,
        region,
        credentialProvider,
      });
    } catch {
      // Metrics enrichment is optional. Continue scan without blocking.
    }
  }

  return { resources, warnings };
}

export type AwsScanOptions = {
  /**
   * Regions to scan:
   * - undefined: use credentials.aws.region (single region, backward compatible)
   * - ['all']: scan all available regions
   * - ['us-east-1', 'eu-west-1']: scan specific regions
   */
  regions?: string[];
  /**
   * Callback for progress updates during multi-region scan.
   */
  onProgress?: (completed: number, total: number, currentRegion: string) => void;
};

/**
 * Scan AWS infrastructure across one or multiple regions.
 *
 * @param credentials - AWS credentials (IAM keys or role ARN)
 * @param options - Scan options including regions to scan
 */
export async function scanAws(
  credentials: DiscoveryCredentials,
  options: AwsScanOptions = {}
): Promise<DiscoveryConnectorResult> {
  // Determine which regions to scan
  let regionsToScan: string[] = [];

  if (options.regions && options.regions.length > 0) {
    if (options.regions.includes("all")) {
      // Fetch all available regions
      regionsToScan = await getAllAwsRegions(credentials);
      if (regionsToScan.length === 0) {
        return { resources: [], flows: [], warnings: ["Could not fetch AWS regions"] };
      }
    } else {
      regionsToScan = options.regions;
    }
  } else if (credentials.aws?.region) {
    // Backward compatible: single region from credentials
    regionsToScan = [credentials.aws.region];
  } else {
    return emptyResult();
  }

  const allResources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  let completed = 0;
  let remainingCloudWatchCalls = AWS_CLOUDWATCH_MAX_CALLS_PER_SCAN;
  const regionScanInputs = regionsToScan.map((region, index) => ({ region, index }));

  // Scan regions with rate limiting (max concurrent)
  const results = await processInBatches(regionScanInputs, AWS_MAX_CONCURRENT_REGIONS, async ({ region, index }) => {
    const collectCloudWatchMetrics = remainingCloudWatchCalls > 0;
    if (collectCloudWatchMetrics) {
      remainingCloudWatchCalls -= 1;
    }
    const regionScan = await scanAwsRegion(region, credentials, {
      collectCloudWatchMetrics,
      includeGlobalServices: index === 0,
    });
    completed++;
    options.onProgress?.(completed, regionsToScan.length, region);
    return { region, ...regionScan };
  });

  // Aggregate results
  for (const result of results) {
    if (result.status === "fulfilled") {
      allResources.push(...result.value.resources);
      if (result.value.warnings.length > 0) {
        warnings.push(...result.value.warnings);
      }
    } else {
      // Extract region from error if possible
      const errorMsg = result.reason?.message || String(result.reason);
      warnings.push(`AWS scan failed for region: ${errorMsg}`);
    }
  }

  try {
    await enrichAwsResourcesWithCostExplorer({
      resources: allResources,
      credentials,
    });
  } catch {
    warnings.push("AWS Cost Explorer enrichment skipped (insufficient permissions or unavailable API).");
  }

  return { resources: allResources, flows: [], warnings };
}

export async function scanAzure(credentials: DiscoveryCredentials): Promise<DiscoveryConnectorResult> {
  if (!credentials.azure?.tenantId || !credentials.azure?.clientId || !credentials.azure?.clientSecret) {
    return emptyResult();
  }
  const subscriptionId = credentials.azure.subscriptionId;
  if (!subscriptionId) return emptyResult();

  const credential = new ClientSecretCredential(
    credentials.azure.tenantId,
    credentials.azure.clientId,
    credentials.azure.clientSecret
  );

  const resourceClient = new ResourceManagementClient(credential, subscriptionId);
  const computeClient = new ComputeManagementClient(credential, subscriptionId);
  const aksClient = new ContainerServiceClient(credential, subscriptionId);
  const storageClient = new StorageManagementClient(credential, subscriptionId);
  const sqlClient = new SqlManagementClient(credential, subscriptionId);

  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const vmssCapacityById = new Map<string, number>();

  for await (const resource of resourceClient.resources.list()) {
    resources.push(
      buildResource({
        source: "azure",
        externalId: resource.id || resource.name || "resource",
        name: resource.name || resource.id || "resource",
        kind: "infra",
        type: resource.type || "RESOURCE",
        metadata: {
          location: resource.location,
          tags: resource.tags,
          businessTags: toBusinessTagMap(resource.tags || {}),
        },
      })
    );
  }

  try {
    for await (const vmss of computeClient.virtualMachineScaleSets.listAll()) {
      if (!vmss.id) continue;
      vmssCapacityById.set(vmss.id, Number(vmss.sku?.capacity || 0));
    }
  } catch {
    warnings.push("Failed to list Azure VM scale sets");
  }

  for await (const vm of computeClient.virtualMachines.listAll()) {
    const vmssId =
      (vm as any)?.virtualMachineScaleSet?.id ||
      (vm.id && vm.id.includes('/virtualMachineScaleSets/')
        ? vm.id.split('/virtualMachines/')[0]
        : null);
    const availabilityZone =
      Array.isArray(vm.zones) && vm.zones.length > 0
        ? vm.zones[0]
        : null;
    resources.push(
      buildResource({
        source: "azure",
        externalId: vm.id || vm.name || "vm",
        name: vm.name || "vm",
        kind: "infra",
        type: "AZURE_VM",
        metadata: {
          size: vm.hardwareProfile?.vmSize,
          vmSize: vm.hardwareProfile?.vmSize,
          osType: vm.storageProfile?.osDisk?.osType,
          location: vm.location,
          availabilityZone,
          availabilityZones: vm.zones || [],
          availabilitySetId: vm.availabilitySet?.id || null,
          vmssId: vmssId || null,
          vmssInstanceCount: vmssId ? vmssCapacityById.get(vmssId) || 0 : 0,
        },
      })
    );
  }

  for await (const cluster of aksClient.managedClusters.list()) {
    resources.push(
      buildResource({
        source: "azure",
        externalId: cluster.id || cluster.name || "aks",
        name: cluster.name || "aks",
        kind: "infra",
        type: "AKS",
        metadata: {
          kubernetesVersion: cluster.kubernetesVersion,
          location: cluster.location,
          agentPoolProfilesCount: cluster.agentPoolProfiles?.length || 0,
          agentPoolNodeCount: (cluster.agentPoolProfiles || []).reduce(
            (sum: number, pool: any) => sum + Number(pool.count || 0),
            0,
          ),
          availabilityZones: Array.from(
            new Set(
              (cluster.agentPoolProfiles || []).flatMap((pool: any) =>
                Array.isArray(pool.availabilityZones) ? pool.availabilityZones : [],
              ),
            ),
          ),
          agentPoolProfiles: (cluster.agentPoolProfiles || []).map((pool: any) => ({
            name: pool.name,
            count: pool.count,
            availabilityZones: pool.availabilityZones || [],
          })),
        },
      })
    );
  }

  for await (const account of storageClient.storageAccounts.list()) {
    resources.push(
      buildResource({
        source: "azure",
        externalId: account.id || account.name || "storage",
        name: account.name || "storage",
        kind: "infra",
        type: "STORAGE",
        metadata: {
          location: account.location,
          kind: account.kind,
          replication: account.sku?.name || null,
          skuName: account.sku?.name || null,
        },
      })
    );
  }

  // Azure SQL Servers and Databases
  try {
    for await (const server of sqlClient.servers.list()) {
      const serverName = server.name || "sql-server";
      resources.push(
        buildResource({
          source: "azure",
          externalId: server.id || serverName,
          name: serverName,
          kind: "infra",
          type: "AZURE_SQL_SERVER",
          ip: server.fullyQualifiedDomainName || null,
          metadata: {
            location: server.location,
            version: server.version,
            state: server.state,
            administratorLogin: server.administratorLogin,
            publicNetworkAccess: server.publicNetworkAccess,
            minimalTlsVersion: server.minimalTlsVersion,
          },
        })
      );

      // List databases for this server
      const resourceGroup = server.id?.split("/")[4];
      if (resourceGroup && server.name) {
        try {
          const failoverGroupByDatabase = new Map<string, string>();
          try {
            for await (const group of sqlClient.failoverGroups.listByServer(resourceGroup, server.name)) {
              const groupId = group.id || group.name || null;
              const databases = Array.isArray((group as any).databases) ? (group as any).databases : [];
              for (const databaseRef of databases) {
                const ref = String(databaseRef || '');
                const dbName = ref.split('/').pop() || ref;
                if (dbName && groupId) {
                  failoverGroupByDatabase.set(dbName, groupId);
                }
              }
            }
          } catch {
            warnings.push(`Failed to list failover groups for SQL server: ${serverName}`);
          }

          for await (const db of sqlClient.databases.listByServer(resourceGroup, server.name)) {
            const dbName = String(db.name || '');
            resources.push(
              buildResource({
                source: "azure",
                externalId: db.id || `${serverName}/${db.name}`,
                name: `${serverName}/${db.name}`,
                kind: "infra",
                type: "AZURE_SQL_DATABASE",
                metadata: {
                  location: db.location,
                  serverName,
                  status: db.status,
                  edition: db.sku?.tier,
                  sku: db.sku?.name,
                  maxSizeBytes: db.maxSizeBytes,
                  collation: db.collation,
                  zoneRedundant: db.zoneRedundant,
                  readScale: db.readScale,
                  currentServiceObjectiveName: db.currentServiceObjectiveName,
                  failoverGroupId: failoverGroupByDatabase.get(dbName) || null,
                  geoReplicationLinks: db.secondaryType ? 1 : 0,
                  highAvailabilityMode: db.zoneRedundant ? 'ZoneRedundant' : 'Disabled',
                },
              })
            );
          }
        } catch {
          warnings.push(`Failed to list databases for SQL server: ${serverName}`);
        }
      }
    }
  } catch {
    warnings.push("Failed to list Azure SQL servers");
  }

  return { resources, flows: [], warnings };
}

export async function scanGcp(credentials: DiscoveryCredentials): Promise<DiscoveryConnectorResult> {
  if (!credentials.gcp?.projectId || !credentials.gcp?.clientEmail || !credentials.gcp?.privateKey) {
    return emptyResult();
  }

  const resources: DiscoveredResource[] = [];
  const warnings: string[] = [];
  const projectId = credentials.gcp.projectId;
  const clientEmail = credentials.gcp.clientEmail;
  const privateKey = credentials.gcp.privateKey;

  const instancesClient = new InstancesClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
    projectId,
  });
  const instanceGroupManagersClient = new InstanceGroupManagersClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
    projectId,
  });
  const migSizeByRef = new Map<string, number>();

  const aggregatedIterable: AsyncIterable<
    [string, protos.google.cloud.compute.v1.IInstancesScopedList]
  > = instancesClient.aggregatedListAsync({ project: projectId });

  for await (const [zone, response] of aggregatedIterable) {
    const zoneName = String(zone || '').split('/').pop() || String(zone || '');
    for (const instance of response.instances || []) {
      const metadataItems = Array.isArray(instance.metadata?.items) ? instance.metadata.items : [];
      const createdByItem = metadataItems.find((item: any) => item?.key === 'created-by');
      const migRef =
        typeof createdByItem?.value === 'string' &&
        createdByItem.value.includes('/instanceGroupManagers/')
          ? createdByItem.value
          : null;

      if (migRef && !migSizeByRef.has(migRef)) {
        const parsed = parseGcpInstanceGroupManagerPath(migRef);
        if (parsed) {
          try {
            const [group] = await instanceGroupManagersClient.get({
              project: projectId,
              zone: parsed.zone,
              instanceGroupManager: parsed.name,
            });
            migSizeByRef.set(migRef, Number((group as any)?.targetSize || 0));
          } catch {
            migSizeByRef.set(migRef, 0);
            warnings.push(`Failed to read GCP managed instance group: ${parsed.name}`);
          }
        } else {
          migSizeByRef.set(migRef, 0);
        }
      }

      const machineType = String(instance.machineType || '').split('/').pop() || instance.machineType || null;
      resources.push(
        buildResource({
          source: "gcp",
          externalId: instance.id?.toString() || instance.name || "compute",
          name: instance.name || "compute",
          kind: "infra",
          type: "GCE",
          ip: instance.networkInterfaces?.[0]?.networkIP || null,
          hostname: instance.hostname || null,
          metadata: {
            zone: zoneName,
            machineType,
            instanceType: machineType,
            instanceGroupManager: migRef,
            instanceGroupSize: migRef ? migSizeByRef.get(migRef) || 0 : 0,
            status: instance.status,
            labels: instance.labels || null,
            businessTags: toBusinessTagMap(instance.labels || {}),
          },
        })
      );
    }
  }

  const containerClient = new ClusterManagerClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
  });
  const [clusters] = await containerClient.listClusters({ parent: `projects/${projectId}/locations/-` });
  clusters.clusters?.forEach((cluster) => {
    resources.push(
      buildResource({
        source: "gcp",
        externalId: cluster.selfLink || cluster.name || "gke",
        name: cluster.name || "gke",
        kind: "infra",
        type: "GKE",
        metadata: {
          endpoint: cluster.endpoint,
          version: cluster.currentMasterVersion,
          location: cluster.location,
          locations: cluster.locations || [],
          nodePoolLocations: (cluster.nodePools || []).flatMap((pool) =>
            Array.isArray(pool.locations) ? pool.locations : [],
          ),
          nodePoolsConfig: (cluster.nodePools || []).map((pool) => ({
            name: pool.name,
            locations: pool.locations || [],
            nodeCount: pool.initialNodeCount || null,
          })),
          labels: cluster.resourceLabels || null,
          businessTags: toBusinessTagMap(cluster.resourceLabels || {}),
        },
      })
    );
  });

  const sqlClient = new SqlInstancesServiceClient({
    credentials: { client_email: clientEmail, private_key: privateKey },
  });
  const [instances] = await sqlClient.list({ project: projectId });
  instances.items?.forEach((instance: any) => {
    resources.push(
      buildResource({
        source: "gcp",
        externalId: instance.name || instance.connectionName || "sql",
        name: instance.name || "sql",
        kind: "infra",
        type: "CLOUD_SQL",
        metadata: {
          region: instance.region,
          databaseVersion: instance.databaseVersion,
          availabilityType: instance.settings?.availabilityType,
          replicaNames: instance.replicaNames || [],
          tier: instance.settings?.tier || null,
          labels: instance.settings?.userLabels || null,
          businessTags: toBusinessTagMap(instance.settings?.userLabels || {}),
        },
      })
    );
  });

  return { resources, flows: [], warnings };
}
