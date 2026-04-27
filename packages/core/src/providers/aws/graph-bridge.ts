/**
 * Transforms DiscoveredResource[] into ScanResult for graph ingestion.
 * Pure functional transformations — no external dependencies.
 */

import type { DiscoveredFlow, DiscoveredResource } from '../../types/discovery.js';
import type { InfraNodeAttrs, ScanEdge, ScanResult } from '../../types/infrastructure.js';
import { EdgeType, NodeType } from '../../types/infrastructure.js';

function mapResourceTypeToNodeType(source: string, type: string): string {
  const lower = type.toLowerCase();

  if (source === 'nmap' || source === 'network') {
    if (lower.includes('database') || lower.includes('db')) return NodeType.DATABASE;
    if (lower.includes('server') || lower.includes('host')) return NodeType.PHYSICAL_SERVER;
    if (lower.includes('router') || lower.includes('switch') || lower.includes('network')) {
      return NodeType.NETWORK_DEVICE;
    }
    return NodeType.PHYSICAL_SERVER;
  }

  if (source === 'aws' || source === 'aws-ec2') return mapAwsType(lower);
  if (source === 'azure') return mapAzureType(lower);
  if (source === 'gcp') return mapGcpType(lower);
  if (source === 'kubernetes' || source === 'k8s') return mapK8sType(lower);
  if (source === 'vmware' || source === 'hyperv') return NodeType.VM;

  return mapGenericType(lower);
}

function mapAwsType(lower: string): string {
  const normalized = lower.replace(/_/g, '-');

  if (normalized.includes('ec2') || normalized === 'instance') return NodeType.VM;
  if (normalized.includes('aurora')) return NodeType.DATABASE;
  if (normalized.includes('rds') || normalized.includes('database')) return NodeType.DATABASE;
  if (normalized.includes('step-function') || normalized.includes('state-machine')) {
    return NodeType.SERVERLESS;
  }
  if (normalized.includes('lambda')) return NodeType.SERVERLESS;
  if (normalized.includes('ecs') || normalized.includes('fargate')) return NodeType.CONTAINER;
  if (normalized.includes('eks')) return NodeType.KUBERNETES_CLUSTER;
  if (
    normalized.includes('elb') ||
    normalized.includes('load') ||
    normalized.includes('alb') ||
    normalized.includes('nlb')
  ) {
    return NodeType.LOAD_BALANCER;
  }
  if (normalized.includes('s3') || normalized.includes('bucket')) return NodeType.OBJECT_STORAGE;
  if (
    normalized.includes('elasticache') ||
    normalized.includes('cache') ||
    normalized.includes('redis') ||
    normalized.includes('memcache')
  ) {
    return NodeType.CACHE;
  }
  if (
    normalized.includes('sqs') ||
    normalized.includes('sns') ||
    normalized.includes('eventbridge') ||
    normalized.includes('kinesis') ||
    normalized.includes('queue') ||
    normalized.includes('topic')
  ) {
    return NodeType.MESSAGE_QUEUE;
  }
  if (normalized.includes('cloudfront')) return NodeType.CDN;
  if (normalized.includes('route53') || normalized.includes('dns')) return NodeType.DNS;
  if (normalized.includes('backup-plan') || normalized.includes('backup-vault')) {
    return NodeType.FILE_STORAGE;
  }
  if (
    normalized.includes('efs') ||
    normalized.includes('mount-target') ||
    normalized.includes('file-system')
  ) {
    return NodeType.FILE_STORAGE;
  }
  if (normalized.includes('cloudwatch') && normalized.includes('alarm')) return NodeType.APPLICATION;
  if (normalized.includes('apigateway') || normalized.includes('api-gateway')) {
    return NodeType.API_GATEWAY;
  }
  if (normalized.includes('vpc')) return NodeType.VPC;
  if (normalized.includes('subnet')) return NodeType.SUBNET;
  if (normalized.includes('dynamodb')) return NodeType.DATABASE;
  if (
    normalized.includes('security-group') ||
    normalized.includes('security_group') ||
    normalized === 'sg'
  ) {
    return NodeType.FIREWALL;
  }
  if (isAwsNetworkDevice(normalized)) return NodeType.NETWORK_DEVICE;
  if (normalized.includes('asg')) return NodeType.VM;
  return NodeType.VM;
}

function isAwsNetworkDevice(lower: string): boolean {
  return (
    lower.includes('route_table') ||
    lower.includes('route-table') ||
    lower.includes('internet_gateway') ||
    lower.includes('internet-gateway') ||
    lower.includes('nat_gateway') ||
    lower.includes('nat-gateway') ||
    lower.includes('network_acl') ||
    lower.includes('network-acl') ||
    lower.includes('transit_gateway') ||
    lower.includes('transit-gateway')
  );
}

function mapAzureType(lower: string): string {
  if (lower.includes('virtual') && lower.includes('machine')) return NodeType.VM;
  if (lower.includes('aks') || lower.includes('kubernetes')) return NodeType.KUBERNETES_CLUSTER;
  if (
    lower.includes('sql') ||
    lower.includes('cosmos') ||
    lower.includes('database') ||
    lower.includes('postgres') ||
    lower.includes('mysql')
  ) {
    return NodeType.DATABASE;
  }
  if (lower.includes('storage')) return NodeType.OBJECT_STORAGE;
  if (lower.includes('redis')) return NodeType.CACHE;
  if (lower.includes('function') || lower.includes('logic')) return NodeType.SERVERLESS;
  if (lower.includes('app-service') || lower.includes('webapp')) return NodeType.APPLICATION;
  if (lower.includes('load-balancer') || lower.includes('application-gateway')) {
    return NodeType.LOAD_BALANCER;
  }
  if (lower.includes('vnet') || lower.includes('virtual-network')) return NodeType.VPC;
  if (lower.includes('service-bus') || lower.includes('event-hub') || lower.includes('event-grid')) {
    return NodeType.MESSAGE_QUEUE;
  }
  if (lower.includes('cdn')) return NodeType.CDN;
  if (lower.includes('dns')) return NodeType.DNS;
  return NodeType.VM;
}

function mapGcpType(lower: string): string {
  if (lower.includes('instance') || lower.includes('compute')) return NodeType.VM;
  if (lower.includes('gke') || lower.includes('kubernetes')) return NodeType.KUBERNETES_CLUSTER;
  if (
    lower.includes('sql') ||
    lower.includes('spanner') ||
    lower.includes('firestore') ||
    lower.includes('bigtable')
  ) {
    return NodeType.DATABASE;
  }
  if (lower.includes('storage') || lower.includes('bucket')) return NodeType.OBJECT_STORAGE;
  if (lower.includes('memorystore') || lower.includes('redis')) return NodeType.CACHE;
  if (lower.includes('function') || lower.includes('run')) return NodeType.SERVERLESS;
  if (lower.includes('lb') || lower.includes('load')) return NodeType.LOAD_BALANCER;
  if (lower.includes('pubsub') || lower.includes('pub/sub') || lower.includes('cloudtasks')) {
    return NodeType.MESSAGE_QUEUE;
  }
  if (lower.includes('cdn')) return NodeType.CDN;
  if (lower.includes('dns')) return NodeType.DNS;
  return NodeType.VM;
}

function mapK8sType(lower: string): string {
  if (lower.includes('pod')) return NodeType.KUBERNETES_POD;
  if (lower.includes('deployment') || lower.includes('statefulset') || lower.includes('daemonset')) {
    return NodeType.CONTAINER;
  }
  if (lower.includes('service') || lower.includes('svc')) return NodeType.KUBERNETES_SERVICE;
  if (lower.includes('ingress')) return NodeType.LOAD_BALANCER;
  if (lower.includes('cluster') || lower.includes('node')) return NodeType.KUBERNETES_CLUSTER;
  if (lower.includes('volume') || lower.includes('pvc')) return NodeType.FILE_STORAGE;
  return NodeType.CONTAINER;
}

function mapGenericType(lower: string): string {
  if (lower.includes('database') || lower.includes('db') || lower.includes('dynamodb')) {
    return NodeType.DATABASE;
  }
  if (lower.includes('cache') || lower.includes('redis')) return NodeType.CACHE;
  if (lower.includes('s3') || lower.includes('bucket') || lower.includes('storage')) {
    return NodeType.OBJECT_STORAGE;
  }
  if (
    lower.includes('queue') ||
    lower.includes('topic') ||
    lower.includes('mq') ||
    lower.includes('sqs') ||
    lower.includes('sns')
  ) {
    return NodeType.MESSAGE_QUEUE;
  }
  if (lower.includes('load') || lower.includes('lb')) return NodeType.LOAD_BALANCER;
  if (lower.includes('container') || lower.includes('docker')) return NodeType.CONTAINER;
  if (lower.includes('server')) return NodeType.PHYSICAL_SERVER;
  return NodeType.APPLICATION;
}

function mapSourceToProvider(source: string): string {
  if (source.startsWith('aws')) return 'aws';
  if (source === 'azure') return 'azure';
  if (source === 'gcp') return 'gcp';
  if (source === 'kubernetes' || source === 'k8s') return 'kubernetes';
  if (source === 'vmware' || source === 'hyperv') return 'on_premise';
  if (source === 'nmap' || source === 'network') return 'on_premise';
  return 'manual';
}

function extractRegion(resource: DiscoveredResource): string | null {
  if (resource.region) return resource.region;
  const meta = resource.metadata;
  if (meta?.region) return String(meta.region);
  if (meta?.location) return String(meta.location);
  if (meta?.zone) return String(meta.zone).replace(/[a-z]$/, '').replace(/-$/, '');
  return null;
}

function extractAZ(resource: DiscoveredResource): string | null {
  const meta = resource.metadata;
  if (meta?.availabilityZone) return String(meta.availabilityZone);
  if (meta?.zone) return String(meta.zone);
  return null;
}

function readStringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRecordArray(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    .map((entry) => entry as Record<string, unknown>);
}

function readRecordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringArrayValue(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readStringValue(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function toEngineLabel(engine: string | null): string | null {
  if (!engine) return null;
  const lower = engine.toLowerCase();
  if (lower.includes('postgres')) return 'PostgreSQL';
  if (lower.includes('mysql')) return 'MySQL';
  if (lower.includes('mariadb')) return 'MariaDB';
  if (lower.includes('oracle')) return 'Oracle';
  if (lower.includes('sqlserver') || lower.includes('sql-server')) return 'SQL Server';
  if (lower.includes('redis')) return 'Redis';
  if (lower.includes('memcache')) return 'Memcached';
  return engine;
}

function inferAwsServiceLabel(
  nodeType: string,
  sourceType: string,
  metadata: Record<string, unknown>,
): string | undefined {
  const sourceLower = sourceType.toLowerCase().replace(/_/g, '-');
  const engine = toEngineLabel(readStringValue(metadata.engine));

  if (nodeType === NodeType.VM) return 'EC2 Instance';
  if (nodeType === NodeType.SERVERLESS) {
    if (sourceLower.includes('step-function') || sourceLower.includes('state-machine')) {
      return 'Step Functions State Machine';
    }
    return 'Lambda Function';
  }
  if (nodeType === NodeType.CONTAINER) {
    if (sourceLower.includes('ecs-cluster')) return 'ECS Cluster';
    if (sourceLower.includes('ecs-service')) return 'ECS Service';
    if (sourceLower.includes('ecs-task-definition')) return 'ECS Task Definition';
    if (sourceLower.includes('ecs-task')) return 'ECS Task';
    if (sourceLower.includes('ecs-capacity-provider')) return 'ECS Capacity Provider';
  }
  if (nodeType === NodeType.CACHE) {
    if (sourceLower.includes('elasticache')) return `ElastiCache ${engine ?? 'Cache'}`;
    return engine ? `${engine} Cache` : 'Cache Service';
  }
  if (nodeType === NodeType.DATABASE) {
    if (sourceLower.includes('aurora-global')) return 'Aurora Global Database';
    if (sourceLower.includes('aurora-cluster')) return `Aurora ${engine ?? 'Cluster'}`;
    if (sourceLower.includes('aurora-instance')) return `Aurora ${engine ?? 'Instance'}`;
    if (sourceLower.includes('dynamodb')) return 'DynamoDB Table';
    if (sourceLower.includes('rds')) return `RDS ${engine ?? 'Database'}`;
    return engine ? `${engine} Database` : 'Database Service';
  }
  if (nodeType === NodeType.FILE_STORAGE) {
    if (sourceLower.includes('efs-mount-target')) return 'EFS Mount Target';
    if (sourceLower.includes('efs')) return 'EFS File System';
  }
  if (nodeType === NodeType.OBJECT_STORAGE) {
    if (sourceLower.includes('s3') || sourceLower.includes('bucket')) return 'S3 Bucket';
    return 'Object Storage';
  }
  if (nodeType === NodeType.MESSAGE_QUEUE) {
    if (sourceLower.includes('eventbridge')) return 'EventBridge Rule';
    if (sourceLower.includes('sns') || sourceLower.includes('topic')) return 'SNS Topic';
    if (sourceLower.includes('sqs') || sourceLower.includes('queue')) return 'SQS Queue';
    return 'Messaging Service';
  }
  if (
    nodeType === NodeType.LOAD_BALANCER &&
    (sourceLower.includes('elb') || sourceLower.includes('alb') || sourceLower.includes('nlb'))
  ) {
    return 'Elastic Load Balancer';
  }

  return undefined;
}

function resolveDisplayName(
  resource: DiscoveredResource,
  tags: Record<string, string>,
  metadata: Record<string, unknown>,
): string {
  const tagName = readStringValue(tags.Name) ?? readStringValue(tags.name);
  if (tagName) return tagName;

  const sourceType = String(resource.type || '').toLowerCase();
  const metadataName =
    readStringValue(metadata.displayName) ??
    readStringValue(metadata.dbIdentifier) ??
    readStringValue(metadata.dbClusterIdentifier) ??
    readStringValue(metadata.dbInstanceIdentifier) ??
    readStringValue(metadata.globalClusterIdentifier) ??
    readStringValue(metadata.cacheClusterId) ??
    readStringValue(metadata.tableName) ??
    readStringValue(metadata.bucketName) ??
    readStringValue(metadata.queueName) ??
    readStringValue(metadata.topicName) ??
    readStringValue(metadata.fileSystemId) ??
    readStringValue(metadata.mountTargetId) ??
    readStringValue(metadata.backupPlanName) ??
    readStringValue(metadata.backupVaultName) ??
    readStringValue(metadata.alarmName) ??
    readStringValue(metadata.clusterName) ??
    readStringValue(metadata.serviceName) ??
    readStringValue(metadata.ruleName) ??
    readStringValue(metadata.stateMachineName) ??
    readStringValue(metadata.family);
  if (metadataName) return metadataName;

  if (sourceType.includes('topic')) {
    const topicArn = readStringValue(metadata.topicArn) ?? resource.arn;
    const inferredTopic = topicArn.split(':').pop();
    if (inferredTopic) return inferredTopic;
  }

  return resource.name || resource.resourceId || resource.arn;
}

function normalizeReference(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase();
}

function addReference(target: Set<string>, value: string | null): void {
  if (!value) return;
  const normalized = normalizeReference(value);
  if (!normalized) return;
  target.add(normalized);

  if (normalized.startsWith('arn:')) {
    const lastColon = normalized.split(':').pop();
    const lastSlash = normalized.split('/').pop();
    if (lastColon) target.add(lastColon);
    if (lastSlash) target.add(lastSlash);
    const loadBalancerMarker = 'loadbalancer/';
    const loadBalancerIndex = normalized.indexOf(loadBalancerMarker);
    if (loadBalancerIndex >= 0) {
      target.add(normalized.slice(loadBalancerIndex + loadBalancerMarker.length));
    }
  }

  if (normalized.includes('.')) {
    target.add(normalized.replace(/^dualstack\./, ''));
  }
}

function getMetadataReferences(metadata: Record<string, unknown>): readonly string[] {
  const references = new Set<string>();
  const keys = [
    'dbIdentifier',
    'dbArn',
    'dbClusterIdentifier',
    'dbClusterArn',
    'dbInstanceIdentifier',
    'dbInstanceArn',
    'globalClusterIdentifier',
    'bucketArn',
    'bucketName',
    'tableArn',
    'tableName',
    'functionArn',
    'functionName',
    'queueArn',
    'queueUrl',
    'queueName',
    'topicArn',
    'topicName',
    'loadBalancerArn',
    'loadBalancerName',
    'loadBalancerResourceName',
    'fileSystemId',
    'fileSystemArn',
    'mountTargetId',
    'dnsName',
    'hostedZoneId',
    'natGatewayId',
    'vpcId',
    'subnetId',
    'clusterArn',
    'clusterName',
    'serviceArn',
    'serviceName',
    'taskDefinitionArn',
    'ruleArn',
    'ruleName',
    'eventBusName',
    'stateMachineArn',
    'stateMachineName',
  ] as const;

  for (const key of keys) addReference(references, readStringValue(metadata[key]));

  if (Array.isArray(metadata.subnetIds)) {
    for (const subnetId of metadata.subnetIds) {
      addReference(references, readStringValue(subnetId));
    }
  }
  for (const key of [
    'targetArns',
    'targetRoleArns',
    'targetDeadLetterArns',
    'ecsTargetTaskDefinitionArns',
    'definitionResourceArns',
  ] as const) {
    for (const entry of readStringArrayValue(metadata[key])) {
      addReference(references, entry);
    }
  }

  return Array.from(references);
}

function buildReferenceIndex(nodes: readonly InfraNodeAttrs[]): ReadonlyMap<string, readonly InfraNodeAttrs[]> {
  const index = new Map<string, InfraNodeAttrs[]>();

  for (const node of nodes) {
    const references = new Set<string>();
    addReference(references, node.id);
    addReference(references, readStringValue(node.resourceId));
    addReference(references, node.name);
    for (const reference of getMetadataReferences(node.metadata)) {
      addReference(references, reference);
    }

    for (const reference of references) {
      const current = index.get(reference) ?? [];
      current.push(node);
      index.set(reference, current);
    }
  }

  return index;
}

function findNodeMatches(
  referenceIndex: ReadonlyMap<string, readonly InfraNodeAttrs[]>,
  reference: string | null,
): readonly InfraNodeAttrs[] {
  if (!reference) return [];
  const normalized = normalizeReference(reference);
  const directMatch = referenceIndex.get(normalized);
  if (directMatch) return directMatch;

  if (normalized.includes('.')) {
    const dualstackStripped = normalized.replace(/^dualstack\./, '');
    if (dualstackStripped !== normalized) {
      return referenceIndex.get(dualstackStripped) ?? [];
    }
  }

  return [];
}

function sourceTypeEquals(node: InfraNodeAttrs, value: string): boolean {
  return readStringValue(node.metadata.sourceType)?.toLowerCase() === value;
}

function addInferredEdge(edges: ScanEdge[], dedupe: Set<string>, edge: ScanEdge): void {
  const key = `${edge.source}|${edge.target}|${edge.type}`;
  if (dedupe.has(key)) return;
  dedupe.add(key);
  edges.push(edge);
}

function addEdgesFromReferences(
  node: InfraNodeAttrs,
  edges: ScanEdge[],
  dedupe: Set<string>,
  referenceIndex: ReadonlyMap<string, readonly InfraNodeAttrs[]>,
  references: readonly string[],
  type: string,
  metadata?: (reference: string) => Record<string, unknown> | undefined,
): void {
  for (const reference of references) {
    for (const target of findNodeMatches(referenceIndex, reference)) {
      if (target.id === node.id) continue;
      addInferredEdge(edges, dedupe, {
        source: node.id,
        target: target.id,
        type,
        confidence: 1.0,
        inferenceMethod: 'metadata',
        provenance: 'aws-api',
        metadata: metadata?.(reference),
      });
    }
  }
}

function addIncomingEdgesFromReferences(
  node: InfraNodeAttrs,
  edges: ScanEdge[],
  dedupe: Set<string>,
  referenceIndex: ReadonlyMap<string, readonly InfraNodeAttrs[]>,
  references: readonly string[],
  type: string,
  metadata?: (reference: string) => Record<string, unknown> | undefined,
): void {
  for (const reference of references) {
    for (const source of findNodeMatches(referenceIndex, reference)) {
      if (source.id === node.id) continue;
      addInferredEdge(edges, dedupe, {
        source: source.id,
        target: node.id,
        type,
        confidence: 1.0,
        inferenceMethod: 'metadata',
        provenance: 'aws-api',
        metadata: metadata?.(reference),
      });
    }
  }
}

function addDirectDependencyEdges(
  node: InfraNodeAttrs,
  edges: ScanEdge[],
  dedupe: Set<string>,
): void {
  for (const dependency of readRecordArray(node.metadata.directDependencyEdges)) {
    const target = readStringValue(dependency.target);
    const type = readStringValue(dependency.type) ?? EdgeType.DEPENDS_ON;
    const source = readStringValue(dependency.source) ?? node.id;
    if (!target || !type || source === target) continue;

    const extraMetadata = readRecordValue(dependency.metadata);
    const relationship = readStringValue(dependency.relationship);
    addInferredEdge(edges, dedupe, {
      source,
      target,
      type,
      confidence: 1.0,
      inferenceMethod: 'metadata',
      provenance: 'aws-api',
      metadata: {
        ...(relationship ? { relationship } : {}),
        ...(extraMetadata ?? {}),
      },
    });
  }
}

function readDestination(value: unknown): string | null {
  const target = readRecordValue(value);
  return readStringValue(target?.destination);
}

function normalizeLambdaEventSourceDependencyArn(eventSourceArn: string): string {
  const streamMarker = '/stream/';
  if (eventSourceArn.includes(':dynamodb:') && eventSourceArn.includes(streamMarker)) {
    return eventSourceArn.slice(0, eventSourceArn.indexOf(streamMarker));
  }
  return eventSourceArn;
}

/**
 * Transforms an array of DiscoveredResource into the ScanResult format
 * expected by GraphService.ingestScanResults().
 */
export function transformToScanResult(
  resources: DiscoveredResource[],
  flows: DiscoveredFlow[],
  provider: string,
): ScanResult {
  const nodes: InfraNodeAttrs[] = [];
  const edges: ScanEdge[] = [];

  for (const resource of resources) {
    const nodeType = mapResourceTypeToNodeType(resource.source, resource.type);
    const providerName = mapSourceToProvider(resource.source);
    const tags = parseTags(resource.tags);
    const region = extractRegion(resource) ?? null;
    const availabilityZone = extractAZ(resource) ?? null;
    const meta =
      resource.metadata && typeof resource.metadata === 'object'
        ? (resource.metadata as Record<string, unknown>)
        : {};
    const displayName = resolveDisplayName(resource, tags, meta);
    const awsServiceLabel =
      providerName === 'aws' ? inferAwsServiceLabel(nodeType, resource.type, meta) : undefined;

    nodes.push({
      id: resource.arn,
      accountId: resource.account.accountId,
      partition: resource.account.partition,
      service: resource.service,
      resourceType: resource.resourceType,
      resourceId: resource.resourceId,
      name: displayName,
      type: nodeType,
      provider: providerName,
      region,
      availabilityZone,
      tags,
      metadata: {
        ...meta,
        arn: resource.arn,
        accountId: resource.account.accountId,
        partition: resource.account.partition,
        service: resource.service,
        resourceType: resource.resourceType ?? undefined,
        resourceId: resource.resourceId,
        source: resource.source,
        sourceType: resource.type,
        region: region ?? undefined,
        availabilityZone: availabilityZone ?? undefined,
        ip: resource.ip ?? undefined,
        hostname: resource.hostname ?? undefined,
        displayName,
        subType: awsServiceLabel ?? undefined,
        awsService: awsServiceLabel ?? undefined,
        openPorts: resource.openPorts ?? undefined,
        isMultiAZ:
          meta.multiAz === true ||
          meta.multiAZ === true ||
          meta.multi_az === true ||
          meta.isMultiAZ === true,
        replicaCount:
          typeof meta.replicaCount === 'number'
            ? meta.replicaCount
            : typeof meta.readReplicaCount === 'number'
              ? meta.readReplicaCount
              : 0,
        isPubliclyAccessible:
          meta.publiclyAccessible === true || meta.isPubliclyAccessible === true,
        status: typeof meta.status === 'string' ? meta.status : 'running',
        securityGroups: meta.securityGroups ?? undefined,
        subnetId: meta.subnetId ?? undefined,
        vpcId: meta.vpcId ?? undefined,
      },
    });
  }

  inferFlowEdges(nodes, flows, edges);
  inferMetadataEdges(nodes, edges);

  return { nodes, edges, provider, scannedAt: new Date() };
}

function parseTags(rawTags: DiscoveredResource['tags']): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!rawTags) return tags;
  if (!Array.isArray(rawTags) && typeof rawTags === 'object') {
    for (const [key, value] of Object.entries(rawTags)) {
      if (typeof value !== 'string') continue;
      const normalizedKey = key.trim();
      if (!normalizedKey) continue;
      tags[normalizedKey] = value;
    }
    return tags;
  }
  for (const tag of rawTags) {
    const separator = tag.lastIndexOf(':');
    if (separator > 0 && separator < tag.length - 1) {
      tags[tag.slice(0, separator)] = tag.slice(separator + 1);
    } else {
      tags[tag] = 'true';
    }
  }
  return tags;
}

function inferFlowEdges(nodes: InfraNodeAttrs[], flows: DiscoveredFlow[], edges: ScanEdge[]): void {
  if (flows.length === 0) return;

  const ipToNodeId = new Map<string, string>();
  for (const node of nodes) {
    const ip = node.metadata?.ip;
    if (ip && typeof ip === 'string') ipToNodeId.set(ip, node.id);
  }

  for (const flow of flows) {
    if (!flow.sourceIp || !flow.targetIp) continue;
    const sourceId = ipToNodeId.get(flow.sourceIp);
    const targetId = ipToNodeId.get(flow.targetIp);
    if (sourceId && targetId && sourceId !== targetId) {
      edges.push({
        source: sourceId,
        target: targetId,
        type: EdgeType.CONNECTS_TO,
        confidence: 0.6,
        inferenceMethod: 'network_flow',
        provenance: 'aws-api',
      });
    }
  }
}

function inferMetadataEdges(nodes: InfraNodeAttrs[], edges: ScanEdge[]): void {
  const vpcNodes = nodes.filter((node) => node.type === NodeType.VPC);
  const subnetNodes = nodes.filter((node) => node.type === NodeType.SUBNET);
  const securityGroupNodes = nodes.filter((node) => node.type === NodeType.FIREWALL);
  const referenceIndex = buildReferenceIndex(nodes);
  const dedupe = new Set<string>();
  const skipTypes = new Set([
    NodeType.VPC,
    NodeType.SUBNET,
    NodeType.REGION,
    NodeType.AVAILABILITY_ZONE,
  ]);

  for (const node of nodes) {
    addDirectDependencyEdges(node, edges, dedupe);

    if (node.type === NodeType.SUBNET && node.metadata.vpcId) {
      const vpc = vpcNodes.find((candidate) => candidate.id.includes(String(node.metadata.vpcId)));
      if (vpc) {
        addInferredEdge(edges, dedupe, {
          source: vpc.id,
          target: node.id,
          type: EdgeType.CONTAINS,
          confidence: 1.0,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    if (sourceTypeEquals(node, 'nat_gateway') && node.metadata.vpcId) {
      const vpc = vpcNodes.find((candidate) => candidate.id.includes(String(node.metadata.vpcId)));
      if (vpc) {
        addInferredEdge(edges, dedupe, {
          source: vpc.id,
          target: node.id,
          type: EdgeType.CONTAINS,
          confidence: 1.0,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    if (
      sourceTypeEquals(node, 'rds') ||
      sourceTypeEquals(node, 'rds_instance') ||
      sourceTypeEquals(node, 'aws_rds_instance')
    ) {
      const replicaIds = Array.isArray(node.metadata.readReplicaDBInstanceIdentifiers)
        ? (node.metadata.readReplicaDBInstanceIdentifiers as unknown[])
            .map((value) => readStringValue(value))
            .filter((value): value is string => Boolean(value))
        : [];
      for (const replicaId of replicaIds) {
        for (const target of findNodeMatches(referenceIndex, replicaId)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.REPLICATES_TO,
            confidence: 1.0,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }

      const sourceIdentifier = readStringValue(node.metadata.readReplicaSourceDBInstanceIdentifier);
      for (const sourceNode of findNodeMatches(referenceIndex, sourceIdentifier)) {
        if (sourceNode.id === node.id) continue;
        addInferredEdge(edges, dedupe, {
          source: sourceNode.id,
          target: node.id,
          type: EdgeType.REPLICATES_TO,
          confidence: 1.0,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    if (sourceTypeEquals(node, 'aurora_cluster')) {
      const memberInstanceIds = Array.isArray(node.metadata.memberInstanceIds)
        ? (node.metadata.memberInstanceIds as unknown[])
            .map((value) => readStringValue(value))
            .filter((value): value is string => Boolean(value))
        : [];
      for (const memberInstanceId of memberInstanceIds) {
        for (const target of findNodeMatches(referenceIndex, memberInstanceId)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.CONTAINS,
            confidence: 1.0,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }

      const replicationSourceIdentifier = readStringValue(node.metadata.replicationSourceIdentifier);
      for (const sourceCluster of findNodeMatches(referenceIndex, replicationSourceIdentifier)) {
        if (sourceCluster.id === node.id) continue;
        addInferredEdge(edges, dedupe, {
          source: sourceCluster.id,
          target: node.id,
          type: EdgeType.REPLICATES_TO,
          confidence: 1.0,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    if (sourceTypeEquals(node, 'aurora_global')) {
      const members = Array.isArray(node.metadata.globalClusterMembers)
        ? (node.metadata.globalClusterMembers as unknown[])
        : [];
      for (const member of members) {
        if (!member || typeof member !== 'object') continue;
        const dbClusterArn = readStringValue((member as Record<string, unknown>).DBClusterArn);
        for (const target of findNodeMatches(referenceIndex, dbClusterArn)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.CONTAINS,
            confidence: 1.0,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }
    }

    if (sourceTypeEquals(node, 'efs_filesystem')) {
      const mountTargetIds = Array.isArray(node.metadata.mountTargetIds)
        ? (node.metadata.mountTargetIds as unknown[])
            .map((value) => readStringValue(value))
            .filter((value): value is string => Boolean(value))
        : [];
      for (const mountTargetId of mountTargetIds) {
        for (const target of findNodeMatches(referenceIndex, mountTargetId)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.CONTAINS,
            confidence: 1.0,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }

      const replications = Array.isArray(node.metadata.replicationConfigurations)
        ? (node.metadata.replicationConfigurations as unknown[])
        : [];
      for (const replication of replications) {
        if (!replication || typeof replication !== 'object') continue;
        const destinationFileSystemId = readStringValue(
          (replication as Record<string, unknown>).destinationFileSystemId,
        );
        for (const target of findNodeMatches(referenceIndex, destinationFileSystemId)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.REPLICATES_TO,
            confidence: 1.0,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }
    }

    if (node.metadata.subnetId && !skipTypes.has(node.type as NodeType)) {
      const subnet = subnetNodes.find((candidate) =>
        candidate.id.includes(String(node.metadata.subnetId)),
      );
      if (subnet) {
        addInferredEdge(edges, dedupe, {
          source: node.id,
          target: subnet.id,
          type: EdgeType.RUNS_ON,
          confidence: 0.9,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
        addInferredEdge(edges, dedupe, {
          source: node.id,
          target: subnet.id,
          type: EdgeType.PLACED_IN,
          confidence: 0.9,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    if (Array.isArray(node.metadata.subnetIds) && !skipTypes.has(node.type as NodeType)) {
      const subnetIds = (node.metadata.subnetIds as unknown[])
        .map((value) => readStringValue(value))
        .filter((value): value is string => Boolean(value));
      for (const subnetId of subnetIds) {
        const subnet = subnetNodes.find((candidate) => candidate.id.includes(subnetId));
        if (!subnet) continue;
        addInferredEdge(edges, dedupe, {
          source: node.id,
          target: subnet.id,
          type: EdgeType.PLACED_IN,
          confidence: 0.9,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    const attachedSecurityGroups = Array.isArray(node.metadata.securityGroups)
      ? (node.metadata.securityGroups as unknown[])
          .map((value) => (typeof value === 'string' ? value : null))
          .filter((value): value is string => Boolean(value))
      : [];
    for (const securityGroupId of attachedSecurityGroups) {
      const securityGroup = securityGroupNodes.find((candidate) =>
        candidate.id.includes(securityGroupId),
      );
      if (!securityGroup) continue;
      addInferredEdge(edges, dedupe, {
        source: node.id,
        target: securityGroup.id,
        type: EdgeType.SECURED_BY,
        confidence: 1.0,
        inferenceMethod: 'metadata',
        provenance: 'aws-api',
        metadata: { securityGroupId },
      });
    }

    if (sourceTypeEquals(node, 'route53_record')) {
      const hostedZoneId = readStringValue(node.metadata.hostedZoneId);
      if (hostedZoneId) {
        const zone = nodes.find(
          (candidate) =>
            sourceTypeEquals(candidate, 'route53_hosted_zone') &&
            (candidate.id === hostedZoneId ||
              readStringValue(candidate.metadata.hostedZoneId) === hostedZoneId),
        );
        if (zone) {
          addInferredEdge(edges, dedupe, {
            source: zone.id,
            target: node.id,
            type: EdgeType.CONTAINS,
            confidence: 1.0,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }

      const aliasTargetDnsName = readStringValue(node.metadata.aliasTargetDnsName);
      for (const target of findNodeMatches(referenceIndex, aliasTargetDnsName)) {
        if (target.id === node.id) continue;
        addInferredEdge(edges, dedupe, {
          source: node.id,
          target: target.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.8,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    if (sourceTypeEquals(node, 'backup_plan')) {
      const protectedResources = Array.isArray(node.metadata.protectedResources)
        ? (node.metadata.protectedResources as unknown[])
        : [];
      for (const protectedResource of protectedResources) {
        if (!protectedResource || typeof protectedResource !== 'object') continue;
        const resourceArn = readStringValue((protectedResource as Record<string, unknown>).resourceArn);
        for (const target of findNodeMatches(referenceIndex, resourceArn)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.BACKS_UP_TO,
            confidence: 1.0,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
            metadata: resourceArn ? { resourceArn } : undefined,
          });
        }
      }

      const rules = Array.isArray(node.metadata.rules) ? (node.metadata.rules as unknown[]) : [];
      for (const rule of rules) {
        if (!rule || typeof rule !== 'object') continue;
        const targetVault = readStringValue((rule as Record<string, unknown>).targetVault);
        if (!targetVault) continue;
        const vault = nodes.find(
          (candidate) =>
            sourceTypeEquals(candidate, 'backup_vault') &&
            (candidate.name === targetVault ||
              readStringValue(candidate.metadata.backupVaultName) === targetVault),
        );
        if (!vault) continue;
        addInferredEdge(edges, dedupe, {
          source: node.id,
          target: vault.id,
          type: EdgeType.BACKS_UP_TO,
          confidence: 0.9,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }
    }

    if (sourceTypeEquals(node, 'cloudwatch_alarm')) {
      const monitoredReferences = Array.isArray(node.metadata.monitoredReferences)
        ? (node.metadata.monitoredReferences as unknown[])
            .map((value) => readStringValue(value))
            .filter((value): value is string => Boolean(value))
        : [];
      for (const reference of monitoredReferences) {
        for (const target of findNodeMatches(referenceIndex, reference)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.MONITORS,
            confidence: 0.9,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }

      const alarmActions = Array.isArray(node.metadata.alarmActions)
        ? (node.metadata.alarmActions as unknown[])
            .map((value) => readStringValue(value))
            .filter((value): value is string => Boolean(value))
        : [];
      for (const alarmAction of alarmActions) {
        for (const target of findNodeMatches(referenceIndex, alarmAction)) {
          if (target.id === node.id) continue;
          addInferredEdge(edges, dedupe, {
            source: node.id,
            target: target.id,
            type: EdgeType.PUBLISHES_TO,
            confidence: 0.9,
            inferenceMethod: 'metadata',
            provenance: 'aws-api',
          });
        }
      }
    }

    if (sourceTypeEquals(node, 'ecs_service')) {
      const clusterArn = readStringValue(node.metadata.clusterArn);
      for (const clusterNode of findNodeMatches(referenceIndex, clusterArn)) {
        if (clusterNode.id === node.id) continue;
        addInferredEdge(edges, dedupe, {
          source: clusterNode.id,
          target: node.id,
          type: EdgeType.CONTAINS,
          confidence: 1.0,
          inferenceMethod: 'metadata',
          provenance: 'aws-api',
        });
      }

      const taskDefinitionArn = readStringValue(node.metadata.taskDefinitionArn);
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        taskDefinitionArn ? [taskDefinitionArn] : [],
        EdgeType.USES,
      );
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        readStringArrayValue([
          node.metadata.roleArn,
          node.metadata.taskRoleArn,
          node.metadata.executionRoleArn,
        ]),
        EdgeType.IAM_ACCESS,
      );
    }

    if (sourceTypeEquals(node, 'eventbridge_rule')) {
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        readStringArrayValue(node.metadata.targetArns),
        EdgeType.TRIGGERS,
      );
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        readStringArrayValue(node.metadata.targetRoleArns),
        EdgeType.IAM_ACCESS,
      );
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        readStringArrayValue(node.metadata.targetDeadLetterArns),
        EdgeType.DEAD_LETTER,
      );
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        readStringArrayValue(node.metadata.ecsTargetTaskDefinitionArns),
        EdgeType.USES,
      );
    }

    if (sourceTypeEquals(node, 'step_function_state_machine')) {
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        readStringArrayValue([
          node.metadata.roleArn,
        ]),
        EdgeType.IAM_ACCESS,
      );
      addEdgesFromReferences(
        node,
        edges,
        dedupe,
        referenceIndex,
        readStringArrayValue(node.metadata.definitionResourceArns),
        EdgeType.USES,
      );
    }

    if (sourceTypeEquals(node, 'lambda')) {
      const deadLetterConfig = readRecordValue(node.metadata.deadLetterConfig);
      const deadLetterTargetArn =
        readStringValue(deadLetterConfig?.targetArn) ??
        readStringValue(node.metadata.deadLetterTargetArn);
      if (deadLetterTargetArn) {
        addEdgesFromReferences(
          node,
          edges,
          dedupe,
          referenceIndex,
          [deadLetterTargetArn],
          EdgeType.DEAD_LETTER,
          () => ({ relationship: 'lambda_dead_letter_queue' }),
        );
      }

      for (const mapping of readRecordArray(node.metadata.eventSourceMappings)) {
        const eventSourceArn = readStringValue(mapping.eventSourceArn);
        if (eventSourceArn) {
          addIncomingEdgesFromReferences(
            node,
            edges,
            dedupe,
            referenceIndex,
            [normalizeLambdaEventSourceDependencyArn(eventSourceArn)],
            EdgeType.TRIGGERS,
            () => ({
              relationship: 'lambda_event_source',
              eventSourceArn,
              uuid: readStringValue(mapping.uuid),
              state: readStringValue(mapping.state),
            }),
          );
        }

        const mappingDestinationConfig = readRecordValue(mapping.destinationConfig);
        const mappingOnFailureDestination = readDestination(mappingDestinationConfig?.onFailure);
        if (mappingOnFailureDestination) {
          addEdgesFromReferences(
            node,
            edges,
            dedupe,
            referenceIndex,
            [mappingOnFailureDestination],
            EdgeType.DEAD_LETTER,
            () => ({
              relationship: 'lambda_event_source_on_failure_destination',
              eventSourceArn,
              uuid: readStringValue(mapping.uuid),
            }),
          );
        }
      }

      const asyncInvokeConfig =
        readRecordValue(node.metadata.asyncInvokeConfig) ??
        readRecordValue(node.metadata.eventInvokeConfig);
      const asyncDestinationConfig = readRecordValue(asyncInvokeConfig?.destinationConfig);
      const onSuccessDestinationArn =
        readDestination(asyncDestinationConfig?.onSuccess) ??
        readStringValue(asyncDestinationConfig?.onSuccessDestination) ??
        readStringValue(node.metadata.onSuccessDestinationArn);
      if (onSuccessDestinationArn) {
        addEdgesFromReferences(
          node,
          edges,
          dedupe,
          referenceIndex,
          [onSuccessDestinationArn],
          EdgeType.PUBLISHES_TO_APPLICATIVE,
          () => ({ relationship: 'lambda_async_on_success_destination' }),
        );
      }

      const onFailureDestinationArn =
        readDestination(asyncDestinationConfig?.onFailure) ??
        readStringValue(asyncDestinationConfig?.onFailureDestination) ??
        readStringValue(node.metadata.onFailureDestinationArn);
      if (onFailureDestinationArn) {
        addEdgesFromReferences(
          node,
          edges,
          dedupe,
          referenceIndex,
          [onFailureDestinationArn],
          EdgeType.DEAD_LETTER,
          () => ({ relationship: 'lambda_async_on_failure_destination' }),
        );
      }
    }
  }
}
