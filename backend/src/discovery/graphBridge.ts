// ============================================================
// Discovery → Graph Bridge
// Transforms existing DiscoveredResource[] into ScanResult
// for ingestion into the resilience graph via GraphService
// ============================================================

import type { DiscoveredResource, DiscoveredFlow } from '../services/discoveryTypes.js';
import type { ScanResult, ScanEdge, InfraNodeAttrs } from '../graph/types.js';
import { NodeType, EdgeType } from '../graph/types.js';

/**
 * Maps existing DiscoveredResource type strings to the new NodeType enum.
 */
function mapResourceTypeToNodeType(source: string, type: string, metadata?: Record<string, unknown> | null): string {
  const lower = type.toLowerCase();

  // Network scan types
  if (source === 'nmap' || source === 'network') {
    if (lower.includes('database') || lower.includes('db')) return NodeType.DATABASE;
    if (lower.includes('server') || lower.includes('host')) return NodeType.PHYSICAL_SERVER;
    if (lower.includes('router') || lower.includes('switch') || lower.includes('network')) return NodeType.NETWORK_DEVICE;
    return NodeType.PHYSICAL_SERVER;
  }

  // AWS resources
  if (source === 'aws' || source === 'aws-ec2') {
    if (lower.includes('ec2') || lower === 'instance') return NodeType.VM;
    if (lower.includes('rds') || lower.includes('database')) return NodeType.DATABASE;
    if (lower.includes('lambda')) return NodeType.SERVERLESS;
    if (lower.includes('ecs') || lower.includes('fargate')) return NodeType.CONTAINER;
    if (lower.includes('eks')) return NodeType.KUBERNETES_CLUSTER;
    if (lower.includes('elb') || lower.includes('load') || lower.includes('alb') || lower.includes('nlb')) return NodeType.LOAD_BALANCER;
    if (lower.includes('s3') || lower.includes('bucket')) return NodeType.OBJECT_STORAGE;
    if (lower.includes('elasticache') || lower.includes('cache') || lower.includes('redis') || lower.includes('memcache')) return NodeType.CACHE;
    if (lower.includes('sqs') || lower.includes('sns') || lower.includes('kinesis') || lower.includes('queue') || lower.includes('topic')) return NodeType.MESSAGE_QUEUE;
    if (lower.includes('cloudfront')) return NodeType.CDN;
    if (lower.includes('route53') || lower.includes('dns')) return NodeType.DNS;
    if (lower.includes('apigateway') || lower.includes('api-gateway')) return NodeType.API_GATEWAY;
    if (lower.includes('vpc')) return NodeType.VPC;
    if (lower.includes('subnet')) return NodeType.SUBNET;
    if (lower.includes('dynamodb')) return NodeType.DATABASE;
    if (lower.includes('security_group') || lower.includes('security-group') || lower === 'sg') return NodeType.FIREWALL;
    if (
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
    ) return NodeType.NETWORK_DEVICE;
    if (lower.includes('asg')) return NodeType.VM;
    return NodeType.VM;
  }

  // Azure resources
  if (source === 'azure') {
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
    if (lower.includes('load-balancer') || lower.includes('application-gateway')) return NodeType.LOAD_BALANCER;
    if (lower.includes('vnet') || lower.includes('virtual-network')) return NodeType.VPC;
    if (lower.includes('service-bus') || lower.includes('event-hub') || lower.includes('event-grid')) {
      return NodeType.MESSAGE_QUEUE;
    }
    if (lower.includes('cdn')) return NodeType.CDN;
    if (lower.includes('dns')) return NodeType.DNS;
    return NodeType.VM;
  }

  // GCP resources
  if (source === 'gcp') {
    if (lower.includes('instance') || lower.includes('compute')) return NodeType.VM;
    if (lower.includes('gke') || lower.includes('kubernetes')) return NodeType.KUBERNETES_CLUSTER;
    if (lower.includes('sql') || lower.includes('spanner') || lower.includes('firestore') || lower.includes('bigtable')) return NodeType.DATABASE;
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

  // Kubernetes resources
  if (source === 'kubernetes' || source === 'k8s') {
    if (lower.includes('pod')) return NodeType.KUBERNETES_POD;
    if (lower.includes('deployment') || lower.includes('statefulset') || lower.includes('daemonset')) return NodeType.CONTAINER;
    if (lower.includes('service') || lower.includes('svc')) return NodeType.KUBERNETES_SERVICE;
    if (lower.includes('ingress')) return NodeType.LOAD_BALANCER;
    if (lower.includes('cluster') || lower.includes('node')) return NodeType.KUBERNETES_CLUSTER;
    if (lower.includes('volume') || lower.includes('pvc')) return NodeType.FILE_STORAGE;
    return NodeType.CONTAINER;
  }

  // VMware/HyperV
  if (source === 'vmware' || source === 'hyperv') {
    return NodeType.VM;
  }

  // Generic mapping
  if (lower.includes('database') || lower.includes('db') || lower.includes('dynamodb')) return NodeType.DATABASE;
  if (lower.includes('cache') || lower.includes('redis')) return NodeType.CACHE;
  if (lower.includes('s3') || lower.includes('bucket') || lower.includes('storage')) return NodeType.OBJECT_STORAGE;
  if (lower.includes('queue') || lower.includes('topic') || lower.includes('mq') || lower.includes('sqs') || lower.includes('sns')) return NodeType.MESSAGE_QUEUE;
  if (lower.includes('load') || lower.includes('lb')) return NodeType.LOAD_BALANCER;
  if (lower.includes('container') || lower.includes('docker')) return NodeType.CONTAINER;
  if (lower.includes('server')) return NodeType.PHYSICAL_SERVER;

  return NodeType.APPLICATION;
}

/**
 * Infers the provider from the source string.
 */
function mapSourceToProvider(source: string): string {
  if (source.startsWith('aws')) return 'aws';
  if (source === 'azure') return 'azure';
  if (source === 'gcp') return 'gcp';
  if (source === 'kubernetes' || source === 'k8s') return 'kubernetes';
  if (source === 'vmware' || source === 'hyperv') return 'on_premise';
  if (source === 'nmap' || source === 'network') return 'on_premise';
  return 'manual';
}

/**
 * Extracts region from resource metadata or name.
 */
function extractRegion(resource: DiscoveredResource): string | null {
  const meta = resource.metadata;
  if (meta?.region) return String(meta.region);
  if (meta?.location) return String(meta.location);
  if (meta?.zone) {
    const zone = String(meta.zone);
    // GCP zone format: us-central1-a → region us-central1
    return zone.replace(/-[a-z]$/, '');
  }
  return null;
}

/**
 * Extracts availability zone from resource metadata.
 */
function extractAZ(resource: DiscoveredResource): string | null {
  const meta = resource.metadata;
  if (meta?.availabilityZone) return String(meta.availabilityZone);
  if (meta?.zone) return String(meta.zone);
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  metadata: Record<string, unknown>
): string | undefined {
  const sourceLower = sourceType.toLowerCase();
  const engine = toEngineLabel(readString(metadata.engine));

  if (nodeType === NodeType.VM) return 'EC2 Instance';
  if (nodeType === NodeType.SERVERLESS) return 'Lambda Function';
  if (nodeType === NodeType.CACHE) {
    if (sourceLower.includes('elasticache')) return `ElastiCache ${engine || 'Cache'}`;
    return engine ? `${engine} Cache` : 'Cache Service';
  }
  if (nodeType === NodeType.DATABASE) {
    if (sourceLower.includes('dynamodb')) return 'DynamoDB Table';
    if (sourceLower.includes('rds')) return `RDS ${engine || 'Database'}`;
    return engine ? `${engine} Database` : 'Database Service';
  }
  if (nodeType === NodeType.OBJECT_STORAGE) {
    if (sourceLower.includes('s3') || sourceLower.includes('bucket')) return 'S3 Bucket';
    return 'Object Storage';
  }
  if (nodeType === NodeType.MESSAGE_QUEUE) {
    if (sourceLower.includes('sns') || sourceLower.includes('topic')) return 'SNS Topic';
    if (sourceLower.includes('sqs') || sourceLower.includes('queue')) return 'SQS Queue';
    return 'Messaging Service';
  }
  if (nodeType === NodeType.LOAD_BALANCER && (sourceLower.includes('elb') || sourceLower.includes('alb') || sourceLower.includes('nlb'))) {
    return 'Elastic Load Balancer';
  }

  return undefined;
}

function resolveDisplayName(
  resource: DiscoveredResource,
  tags: Record<string, string>,
  metadata: Record<string, unknown>
): string {
  const tagName = readString(tags.Name) || readString(tags.name);
  if (tagName) return tagName;

  const sourceType = String(resource.type || '').toLowerCase();
  const metadataName =
    readString(metadata.displayName) ??
    readString(metadata.dbIdentifier) ??
    readString(metadata.cacheClusterId) ??
    readString(metadata.tableName) ??
    readString(metadata.bucketName) ??
    readString(metadata.queueName) ??
    readString(metadata.topicName);
  if (metadataName) return metadataName;

  if (sourceType.includes('topic')) {
    const topicArn = readString(metadata.topicArn) ?? resource.externalId;
    const inferredTopic = topicArn.split(':').pop();
    if (inferredTopic) return inferredTopic;
  }

  return resource.name || resource.externalId;
}

/**
 * Transforms an array of DiscoveredResource into the ScanResult format
 * expected by GraphService.ingestScanResults().
 */
export function transformToScanResult(
  resources: DiscoveredResource[],
  flows: DiscoveredFlow[],
  provider: string
): ScanResult {
  const nodes: InfraNodeAttrs[] = [];
  const edges: ScanEdge[] = [];

  // Transform resources to nodes
  for (const resource of resources) {
    const nodeType = mapResourceTypeToNodeType(resource.source, resource.type, resource.metadata);
    const providerName = mapSourceToProvider(resource.source);

    const tags: Record<string, string> = {};
    if (resource.tags) {
      for (const tag of resource.tags) {
        const separator = tag.lastIndexOf(':');
        if (separator > 0 && separator < tag.length - 1) {
          const key = tag.slice(0, separator);
          const value = tag.slice(separator + 1);
          tags[key] = value;
        } else {
          tags[tag] = 'true';
        }
      }
    }

    const meta =
      resource.metadata && typeof resource.metadata === 'object'
        ? (resource.metadata as Record<string, unknown>)
        : {};
    const displayName = resolveDisplayName(resource, tags, meta);
    const awsServiceLabel = providerName === 'aws'
      ? inferAwsServiceLabel(nodeType, resource.type, meta)
      : undefined;

    const node: InfraNodeAttrs = {
      id: resource.externalId,
      name: displayName,
      type: nodeType,
      provider: providerName,
      region: extractRegion(resource) ?? null,
      availabilityZone: extractAZ(resource) ?? null,
      tags,
      metadata: {
        ...meta,
        source: resource.source,
        sourceType: resource.type,
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
        isPubliclyAccessible: meta.publiclyAccessible === true || meta.isPubliclyAccessible === true,
        status: typeof meta.status === 'string' ? meta.status : 'running',
        securityGroups: meta.securityGroups ?? undefined,
        subnetId: meta.subnetId ?? undefined,
        vpcId: meta.vpcId ?? undefined,
      },
    };

    nodes.push(node);
  }

  // Infer edges from network flows
  if (flows.length > 0) {
    const ipToNodeId = new Map<string, string>();
    for (const node of nodes) {
      const ip = node.metadata?.ip;
      if (ip && typeof ip === 'string') {
        ipToNodeId.set(ip, node.id);
      }
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
        });
      }
    }
  }

  // Infer edges from metadata references (VPC, subnet, security groups)
  const vpcNodes = nodes.filter(n => n.type === NodeType.VPC);
  const subnetNodes = nodes.filter(n => n.type === NodeType.SUBNET);

  for (const node of nodes) {
    // Subnet → VPC (CONTAINS)
    if (node.type === NodeType.SUBNET && node.metadata?.vpcId) {
      const vpc = vpcNodes.find(v => v.id.includes(String(node.metadata!.vpcId)));
      if (vpc) {
        edges.push({ source: vpc.id, target: node.id, type: EdgeType.CONTAINS, confidence: 1.0, inferenceMethod: 'metadata' });
      }
    }

    // Resource → Subnet (RUNS_ON)
    if (node.metadata?.subnetId && ![NodeType.VPC, NodeType.SUBNET, NodeType.REGION, NodeType.AVAILABILITY_ZONE].includes(node.type as NodeType)) {
      const subnet = subnetNodes.find(s => s.id.includes(String(node.metadata!.subnetId)));
      if (subnet) {
        edges.push({ source: node.id, target: subnet.id, type: EdgeType.RUNS_ON, confidence: 0.9, inferenceMethod: 'metadata' });
      }
    }
  }

  return {
    nodes,
    edges,
    provider,
    scannedAt: new Date(),
  };
}
