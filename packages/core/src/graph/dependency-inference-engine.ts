// ============================================================
// DependencyInferenceEngine - Infer missing dependencies
// ============================================================

import type { InfraNodeAttrs, ScanEdge } from '../types/index.js';
import { NodeType, EdgeType } from '../types/index.js';
import { isAnalyzableServiceNode } from './service-classification.js';
import { inferBestEffortEdges } from './fallback-inference-engine.js';

type NodeLookup = {
  byAnyId: Map<string, InfraNodeAttrs>;
  byArn: Map<string, InfraNodeAttrs[]>;
  byQueueUrl: Map<string, InfraNodeAttrs[]>;
  byEndpoint: Map<string, InfraNodeAttrs[]>;
  byName: Map<string, InfraNodeAttrs[]>;
  sgAttachments: Map<string, Set<string>>;
};

type EnvReference = {
  varName: string;
  value: string;
  referenceType?: string;
};

const ARN_PATTERN = /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[A-Za-z0-9\-_/.:]+/g;
const SQS_URL_PATTERN = /https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/[A-Za-z0-9\-_]+/g;
const RDS_ENDPOINT_PATTERN = /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.[A-Za-z0-9-]+\.rds\.amazonaws\.com/g;
const CACHE_ENDPOINT_PATTERN = /[A-Za-z0-9\-]+\.[A-Za-z0-9\-]+\.cache\.amazonaws\.com/g;

/**
 * Infer dependencies that are not explicitly provided by cloud APIs.
 *
 * P0/P1 strategies:
 * 1. Security Group ingress chain
 * 2. Lambda event source mappings
 * 3. Environment references
 * 4. SQS redrive policy (queue -> DLQ)
 * 5. SNS subscriptions
 *
 * Existing heuristic strategies are kept as additive fallback.
 */
export function inferDependencies(nodes: InfraNodeAttrs[], existingEdges: ScanEdge[]): ScanEdge[] {
  const lookup = buildNodeLookup(nodes);
  const inferred: ScanEdge[] = [];

  inferred.push(...inferFromSecurityGroupChain(nodes, lookup));
  inferred.push(...inferFromEventSourceMappings(nodes, lookup));
  inferred.push(...inferFromEnvironmentReferences(nodes, lookup));
  inferred.push(...inferFromSqsRedrive(nodes, lookup));
  inferred.push(...inferFromSnsSubscriptions(nodes, lookup));

  // Existing additive heuristics
  inferred.push(...inferFromSharedSecurityGroups(nodes));
  inferred.push(...inferFromNetwork(nodes));
  inferred.push(...inferFromTags(nodes));
  inferred.push(...inferFromNaming(nodes));
  inferred.push(...inferFromPatterns(nodes, existingEdges));

  const initialInferred = deduplicateEdges(existingEdges, inferred);

  const metadataSignalPresent = nodes.some(hasInferenceMetadataSignal);
  const applicativeEdgesCount =
    countApplicativeEdges(existingEdges) + countApplicativeEdges(initialInferred);
  const minimumExpectedApplicativeEdges = Math.max(2, Math.floor(nodes.length * 0.05));
  const shouldApplyBestEffortFallback =
    !metadataSignalPresent || applicativeEdgesCount < minimumExpectedApplicativeEdges;

  if (!shouldApplyBestEffortFallback) {
    return initialInferred;
  }

  const fallbackInferred = inferBestEffortEdges(nodes, [...existingEdges, ...initialInferred]);
  if (fallbackInferred.length === 0) {
    return initialInferred;
  }

  const dedupedFallback = deduplicateEdges(
    [...existingEdges, ...initialInferred],
    fallbackInferred,
  );
  return [...initialInferred, ...dedupedFallback];
}

const APPLICATIVE_EDGE_TYPES = new Set<string>([
  EdgeType.NETWORK_ACCESS,
  EdgeType.TRIGGERS,
  EdgeType.USES,
  EdgeType.DEAD_LETTER,
  EdgeType.PUBLISHES_TO,
  EdgeType.PUBLISHES_TO_APPLICATIVE,
  EdgeType.CONNECTS_TO,
  EdgeType.DEPENDS_ON,
  EdgeType.ROUTES_TO,
  EdgeType.SUBSCRIBES_TO,
]);

function countApplicativeEdges(edges: ScanEdge[]): number {
  return edges.filter((edge) => APPLICATIVE_EDGE_TYPES.has(edge.type)).length;
}

function hasInferenceMetadataSignal(node: InfraNodeAttrs): boolean {
  const metadata = readRecord(node.metadata);
  if (!metadata) return false;

  const signalKeys = [
    'securityGroups',
    'inboundRules',
    'eventSourceMappings',
    'environmentReferences',
    'environmentVariables',
    'redrivePolicy',
    'deadLetterTargetArn',
    'subscriptions',
  ];

  return signalKeys.some((key) => {
    const value = metadata[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return Boolean(value);
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => readString(entry)).filter((entry): entry is string => Boolean(entry));
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function addToIndex(
  index: Map<string, InfraNodeAttrs[]>,
  key: string | null,
  node: InfraNodeAttrs,
): void {
  if (!key) return;
  const normalized = key.trim().toLowerCase();
  if (!normalized) return;
  if (!index.has(normalized)) index.set(normalized, []);
  index.get(normalized)!.push(node);
}

function toSgKey(value: string): string {
  return value.trim().toLowerCase();
}

function buildNodeLookup(nodes: InfraNodeAttrs[]): NodeLookup {
  const byAnyId = new Map<string, InfraNodeAttrs>();
  const byArn = new Map<string, InfraNodeAttrs[]>();
  const byQueueUrl = new Map<string, InfraNodeAttrs[]>();
  const byEndpoint = new Map<string, InfraNodeAttrs[]>();
  const byName = new Map<string, InfraNodeAttrs[]>();
  const sgAttachments = new Map<string, Set<string>>();

  for (const node of nodes) {
    const metadata = readRecord(node.metadata) || {};
    const sourceType = String(metadata.sourceType || '').toLowerCase();
    const nodeIdKey = node.id.trim().toLowerCase();
    byAnyId.set(nodeIdKey, node);
    if (node.id.startsWith('arn:aws:')) {
      addToIndex(byArn, node.id, node);
    }

    const externalId = readString(node.externalId);
    if (externalId) {
      byAnyId.set(externalId.toLowerCase(), node);
      if (externalId.startsWith('arn:aws:')) {
        addToIndex(byArn, externalId, node);
      }
    }

    const queueArn = readString(metadata.queueArn);
    const topicArn = readString(metadata.topicArn);
    const tableArn = readString(metadata.tableArn);
    const bucketArn = readString(metadata.bucketArn);
    const lambdaArn = readString(metadata.functionArn);
    addToIndex(byArn, queueArn, node);
    addToIndex(byArn, topicArn, node);
    addToIndex(byArn, tableArn, node);
    addToIndex(byArn, bucketArn, node);
    addToIndex(byArn, lambdaArn, node);

    const queueUrl = readString(metadata.queueUrl);
    addToIndex(byQueueUrl, queueUrl, node);

    const endpointCandidates = [
      readString(metadata.endpointAddress),
      readString(metadata.configurationEndpoint),
      readString(metadata.primaryEndpoint),
      readString(metadata.readerEndpoint),
      readString(metadata.endpoint),
      readString(metadata.ip),
      readString(metadata.hostname),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const endpoint of endpointCandidates) {
      addToIndex(byEndpoint, endpoint, node);
    }

    const nameCandidates = [
      node.name,
      readString(metadata.queueName),
      readString(metadata.topicName),
      readString(metadata.tableName),
      readString(metadata.bucketName),
      readString(metadata.dbIdentifier),
      readString(metadata.cacheClusterId),
      readString(metadata.functionName),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const name of nameCandidates) {
      addToIndex(byName, name, node);
    }

    if (node.type !== NodeType.FIREWALL || sourceType.includes('security_group')) {
      const attachedSecurityGroups = asStringArray(metadata.securityGroups);
      for (const sgId of attachedSecurityGroups) {
        const key = toSgKey(sgId);
        if (!sgAttachments.has(key)) sgAttachments.set(key, new Set<string>());
        sgAttachments.get(key)!.add(node.id);
      }
    }
  }

  return {
    byAnyId,
    byArn,
    byQueueUrl,
    byEndpoint,
    byName,
    sgAttachments,
  };
}

function findByExact(
  index: Map<string, InfraNodeAttrs[]>,
  key: string,
  preferred?: (node: InfraNodeAttrs) => boolean,
): InfraNodeAttrs | null {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return null;
  const candidates = index.get(normalized) || [];
  if (candidates.length === 0) return null;
  if (preferred) {
    const match = candidates.find(preferred);
    if (match) return match;
  }
  return candidates[0] || null;
}

function findByPrefix(index: Map<string, InfraNodeAttrs[]>, key: string): InfraNodeAttrs | null {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return null;
  for (const [indexedKey, nodes] of index.entries()) {
    if (normalized.startsWith(indexedKey) || indexedKey.startsWith(normalized)) {
      return nodes[0] || null;
    }
  }
  return null;
}

function resolveNodeByArn(referenceArn: string, lookup: NodeLookup): InfraNodeAttrs | null {
  const exact = findByExact(lookup.byArn, referenceArn);
  if (exact) return exact;

  const streamPrefix = referenceArn.replace(/\/stream\/.*/i, '');
  if (streamPrefix !== referenceArn) {
    const streamBase = findByExact(lookup.byArn, streamPrefix);
    if (streamBase) return streamBase;
  }

  return findByPrefix(lookup.byArn, referenceArn);
}

function resolveNodeByName(reference: string, lookup: NodeLookup): InfraNodeAttrs | null {
  return findByExact(lookup.byName, reference) || findByPrefix(lookup.byName, reference);
}

function resolveNodeByQueueUrl(reference: string, lookup: NodeLookup): InfraNodeAttrs | null {
  return findByExact(lookup.byQueueUrl, reference) || findByPrefix(lookup.byQueueUrl, reference);
}

function resolveNodeByEndpoint(reference: string, lookup: NodeLookup): InfraNodeAttrs | null {
  return findByExact(lookup.byEndpoint, reference) || findByPrefix(lookup.byEndpoint, reference);
}

function looksLikeSecurityGroupId(value: string): boolean {
  return /^sg-[a-z0-9]+$/i.test(value.trim());
}

// =====================================================
//  METHOD 1: SECURITY GROUP CHAIN (P0)
// =====================================================

function inferFromSecurityGroupChain(nodes: InfraNodeAttrs[], lookup: NodeLookup): ScanEdge[] {
  const edges: ScanEdge[] = [];

  const sgNodes = nodes.filter((node) => {
    if (node.type === NodeType.FIREWALL) return true;
    const sourceType = String((readRecord(node.metadata) || {}).sourceType || '').toLowerCase();
    return sourceType.includes('security_group') || sourceType.includes('security-group');
  });

  for (const sgNode of sgNodes) {
    const metadata = readRecord(sgNode.metadata) || {};
    const sgId = (readString(sgNode.externalId) || sgNode.id).trim();
    const destMembers = lookup.sgAttachments.get(toSgKey(sgId));
    if (!destMembers || destMembers.size === 0) continue;

    const inboundRules = asRecordArray(metadata.inboundRules);
    for (const rule of inboundRules) {
      const ruleSources = asStringArray(rule.sources).filter(looksLikeSecurityGroupId);
      if (ruleSources.length === 0) continue;

      const protocol = readString(rule.protocol) || 'all';
      const fromPort = Number(rule.fromPort);
      const toPort = Number(rule.toPort);

      for (const sourceSg of ruleSources) {
        const sourceMembers = lookup.sgAttachments.get(toSgKey(sourceSg));
        if (!sourceMembers || sourceMembers.size === 0) continue;

        for (const sourceNodeId of sourceMembers) {
          const sourceNode = lookup.byAnyId.get(sourceNodeId.toLowerCase());
          if (!sourceNode || !isAnalyzableServiceNode(sourceNode)) continue;

          for (const destNodeId of destMembers) {
            if (sourceNodeId === destNodeId) continue;
            const destNode = lookup.byAnyId.get(destNodeId.toLowerCase());
            if (!destNode || !isAnalyzableServiceNode(destNode)) continue;

            edges.push({
              source: sourceNodeId,
              target: destNodeId,
              type: EdgeType.NETWORK_ACCESS,
              confidence: 0.98,
              inferenceMethod: 'security_group_chain',
              metadata: {
                sgSource: sourceSg,
                sgDest: sgId,
                protocol,
                fromPort: Number.isFinite(fromPort) ? fromPort : null,
                toPort: Number.isFinite(toPort) ? toPort : null,
                detectedBy: 'security_group_chain',
              },
            });
          }
        }
      }
    }
  }

  return edges;
}

// =====================================================
//  METHOD 2: EVENT SOURCE MAPPINGS (P0)
// =====================================================

function inferFromEventSourceMappings(nodes: InfraNodeAttrs[], lookup: NodeLookup): ScanEdge[] {
  const edges: ScanEdge[] = [];

  const lambdaNodes = nodes.filter((node) => {
    if (node.type === NodeType.SERVERLESS) return true;
    const sourceType = String((readRecord(node.metadata) || {}).sourceType || '').toLowerCase();
    return sourceType.includes('lambda');
  });

  for (const lambdaNode of lambdaNodes) {
    const metadata = readRecord(lambdaNode.metadata) || {};
    const mappings = asRecordArray(metadata.eventSourceMappings);
    if (mappings.length === 0) continue;

    for (const mapping of mappings) {
      const eventSourceArn =
        readString(mapping.eventSourceArn) || readString(mapping.EventSourceArn);
      if (!eventSourceArn) continue;

      const sourceNode = resolveNodeByArn(eventSourceArn, lookup);
      if (!sourceNode || sourceNode.id === lambdaNode.id) continue;

      edges.push({
        source: sourceNode.id,
        target: lambdaNode.id,
        type: EdgeType.TRIGGERS,
        confidence: 0.99,
        inferenceMethod: 'event_source_mapping',
        metadata: {
          eventSourceArn,
          batchSize: Number(mapping.batchSize ?? mapping.BatchSize ?? 0) || undefined,
          enabled: Boolean(mapping.enabled ?? mapping.Enabled ?? false),
          state: readString(mapping.state) || readString(mapping.State) || undefined,
          detectedBy: 'event_source_mapping',
        },
      });
    }
  }

  return edges;
}

// =====================================================
//  METHOD 3: ENV REFERENCES (P1)
// =====================================================

function inferFromEnvironmentReferences(nodes: InfraNodeAttrs[], lookup: NodeLookup): ScanEdge[] {
  const edges: ScanEdge[] = [];

  const lambdaNodes = nodes.filter((node) => {
    if (node.type === NodeType.SERVERLESS) return true;
    const sourceType = String((readRecord(node.metadata) || {}).sourceType || '').toLowerCase();
    return sourceType.includes('lambda');
  });

  for (const lambdaNode of lambdaNodes) {
    const metadata = readRecord(lambdaNode.metadata) || {};
    const references = extractEnvReferences(metadata, lookup);
    for (const reference of references) {
      const targetNode = resolveEnvReferenceTarget(reference, lookup);
      if (!targetNode || targetNode.id === lambdaNode.id) continue;

      edges.push({
        source: lambdaNode.id,
        target: targetNode.id,
        type: EdgeType.USES,
        confidence: 0.88,
        inferenceMethod: 'environment_reference',
        metadata: {
          envVarName: reference.varName,
          targetRef: reference.value,
          referenceType: reference.referenceType || 'unknown',
          detectedBy: 'environment_reference',
        },
      });
    }
  }

  return edges;
}

function extractEnvReferences(
  metadata: Record<string, unknown>,
  lookup: NodeLookup,
): EnvReference[] {
  const parsed = asRecordArray(metadata.environmentReferences)
    .map((entry) => {
      const varName = readString(entry.varName) || readString(entry.name);
      const value =
        readString(entry.value) || readString(entry.target) || readString(entry.reference);
      if (!varName || !value) return null;
      const referenceType = readString(entry.referenceType);
      const reference: EnvReference = { varName, value };
      if (referenceType) {
        reference.referenceType = referenceType;
      }
      return reference;
    })
    .filter((entry): entry is EnvReference => Boolean(entry));
  if (parsed.length > 0) return parsed;

  const envVars = readRecord(metadata.environmentVariables);
  if (!envVars) return [];

  const fallback: EnvReference[] = [];
  for (const [rawVarName, rawValue] of Object.entries(envVars)) {
    const varName = readString(rawVarName);
    const value = readString(rawValue);
    if (!varName || !value) continue;

    const arnMatches = value.match(ARN_PATTERN) || [];
    for (const arn of arnMatches) {
      fallback.push({ varName, value: arn, referenceType: 'arn' });
    }

    const sqsMatches = value.match(SQS_URL_PATTERN) || [];
    for (const queueUrl of sqsMatches) {
      fallback.push({ varName, value: queueUrl, referenceType: 'sqs_url' });
    }

    const rdsMatches = value.match(RDS_ENDPOINT_PATTERN) || [];
    for (const endpoint of rdsMatches) {
      fallback.push({ varName, value: endpoint, referenceType: 'rds_endpoint' });
    }

    const cacheMatches = value.match(CACHE_ENDPOINT_PATTERN) || [];
    for (const endpoint of cacheMatches) {
      fallback.push({ varName, value: endpoint, referenceType: 'cache_endpoint' });
    }

    const varUpper = varName.toUpperCase();
    const maybeName = value.trim();
    if (varUpper.includes('TABLE') && resolveNodeByName(maybeName, lookup)) {
      fallback.push({ varName, value: maybeName, referenceType: 'dynamodb_table' });
    } else if (varUpper.includes('BUCKET') && resolveNodeByName(maybeName, lookup)) {
      fallback.push({ varName, value: maybeName, referenceType: 's3_bucket' });
    } else if (
      (varUpper.includes('QUEUE') || varUpper.includes('TOPIC')) &&
      resolveNodeByName(maybeName, lookup)
    ) {
      fallback.push({ varName, value: maybeName, referenceType: 'resource_name' });
    }
  }

  return fallback;
}

function resolveEnvReferenceTarget(
  reference: EnvReference,
  lookup: NodeLookup,
): InfraNodeAttrs | null {
  const refValue = reference.value.trim();
  if (!refValue) return null;
  const refLower = refValue.toLowerCase();

  if (refLower.startsWith('arn:aws:') || reference.referenceType === 'arn') {
    return resolveNodeByArn(refValue, lookup);
  }

  if (reference.referenceType === 'sqs_url' || refLower.startsWith('https://sqs.')) {
    return resolveNodeByQueueUrl(refValue, lookup);
  }

  if (
    reference.referenceType === 'rds_endpoint' ||
    reference.referenceType === 'cache_endpoint' ||
    refLower.includes('.rds.amazonaws.com') ||
    refLower.includes('.cache.amazonaws.com')
  ) {
    return resolveNodeByEndpoint(refValue, lookup);
  }

  return resolveNodeByName(refValue, lookup);
}

// =====================================================
//  METHOD 4: SQS REDRIVE POLICY (P1)
// =====================================================

function inferFromSqsRedrive(nodes: InfraNodeAttrs[], lookup: NodeLookup): ScanEdge[] {
  const edges: ScanEdge[] = [];

  const queueNodes = nodes.filter((node) => {
    if (node.type !== NodeType.MESSAGE_QUEUE) return false;
    const sourceType = String((readRecord(node.metadata) || {}).sourceType || '').toLowerCase();
    return sourceType.includes('sqs') || sourceType.includes('queue');
  });

  for (const queueNode of queueNodes) {
    const metadata = readRecord(queueNode.metadata) || {};
    let deadLetterTargetArn =
      readString(metadata.deadLetterTargetArn) ||
      readString(metadata.dlqArn) ||
      readString(metadata.dead_letter_target_arn);
    let maxReceiveCount: number | null = null;

    const redrivePolicy = readString(metadata.redrivePolicy);
    if (redrivePolicy) {
      try {
        const parsed = JSON.parse(redrivePolicy) as Record<string, unknown>;
        if (!deadLetterTargetArn) {
          deadLetterTargetArn = readString(parsed.deadLetterTargetArn) || null;
        }
        const parsedCount = Number(parsed.maxReceiveCount);
        maxReceiveCount = Number.isFinite(parsedCount) ? parsedCount : null;
      } catch {
        // Ignore malformed redrive policy payload.
      }
    }

    if (!deadLetterTargetArn) continue;
    const dlqNode = resolveNodeByArn(deadLetterTargetArn, lookup);
    if (!dlqNode || dlqNode.id === queueNode.id) continue;

    edges.push({
      source: queueNode.id,
      target: dlqNode.id,
      type: EdgeType.DEAD_LETTER,
      confidence: 0.99,
      inferenceMethod: 'sqs_redrive_policy',
      metadata: {
        deadLetterTargetArn,
        maxReceiveCount,
        detectedBy: 'sqs_redrive_policy',
      },
    });
  }

  return edges;
}

// =====================================================
//  METHOD 5: SNS SUBSCRIPTIONS (P1)
// =====================================================

function inferFromSnsSubscriptions(nodes: InfraNodeAttrs[], lookup: NodeLookup): ScanEdge[] {
  const edges: ScanEdge[] = [];

  const topicNodes = nodes.filter((node) => {
    if (node.type !== NodeType.MESSAGE_QUEUE) return false;
    const sourceType = String((readRecord(node.metadata) || {}).sourceType || '').toLowerCase();
    return sourceType.includes('sns') || sourceType.includes('topic');
  });

  for (const topicNode of topicNodes) {
    const metadata = readRecord(topicNode.metadata) || {};
    const subscriptions = asRecordArray(metadata.subscriptions);
    if (subscriptions.length === 0) continue;

    for (const subscription of subscriptions) {
      const protocol = (readString(subscription.protocol) || '').toLowerCase();
      const endpoint = readString(subscription.endpoint);
      if (!endpoint) continue;
      if (endpoint.toLowerCase() === 'pendingconfirmation') continue;
      if (protocol !== 'lambda' && protocol !== 'sqs') continue;

      const targetNode = resolveNodeByArn(endpoint, lookup);
      if (!targetNode || targetNode.id === topicNode.id) continue;

      edges.push({
        source: topicNode.id,
        target: targetNode.id,
        type: EdgeType.PUBLISHES_TO_APPLICATIVE,
        confidence: 0.97,
        inferenceMethod: 'sns_subscription',
        metadata: {
          protocol,
          endpoint,
          detectedBy: 'sns_subscription',
        },
      });
    }
  }

  return edges;
}

// =====================================================
//  EXISTING HEURISTICS (kept additive)
// =====================================================

function inferFromSharedSecurityGroups(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const sgMap = new Map<string, InfraNodeAttrs[]>();

  for (const node of nodes) {
    const metadata = readRecord(node.metadata) || {};
    const sgs = asStringArray(metadata.securityGroups);
    for (const sg of sgs) {
      const key = sg.trim().toLowerCase();
      if (!sgMap.has(key)) sgMap.set(key, []);
      sgMap.get(key)!.push(node);
    }
  }

  for (const groupNodes of sgMap.values()) {
    if (groupNodes.length < 2 || groupNodes.length > 50) continue;

    const computes = groupNodes.filter((node) =>
      [
        NodeType.VM,
        NodeType.CONTAINER,
        NodeType.SERVERLESS,
        NodeType.APPLICATION,
        NodeType.MICROSERVICE,
      ].includes(node.type as NodeType),
    );
    const dataNodes = groupNodes.filter((node) =>
      [NodeType.DATABASE, NodeType.CACHE, NodeType.MESSAGE_QUEUE].includes(node.type as NodeType),
    );

    for (const compute of computes) {
      for (const data of dataNodes) {
        if (compute.id === data.id) continue;
        edges.push({
          source: compute.id,
          target: data.id,
          type: EdgeType.CONNECTS_TO,
          confidence: 0.85,
          inferenceMethod: 'shared_security_group',
          metadata: { detectedBy: 'shared_security_group' },
        });
      }
    }
  }

  return edges;
}

function inferFromNetwork(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const subnetMap = new Map<string, InfraNodeAttrs[]>();
  const vpcMap = new Map<string, InfraNodeAttrs[]>();

  for (const node of nodes) {
    const metadata = readRecord(node.metadata) || {};
    const subnetId = readString(metadata.subnetId);
    const vpcId = readString(metadata.vpcId);

    if (subnetId) {
      const key = subnetId.toLowerCase();
      if (!subnetMap.has(key)) subnetMap.set(key, []);
      subnetMap.get(key)!.push(node);
    }
    if (vpcId) {
      const key = vpcId.toLowerCase();
      if (!vpcMap.has(key)) vpcMap.set(key, []);
      vpcMap.get(key)!.push(node);
    }
  }

  for (const groupNodes of subnetMap.values()) {
    if (groupNodes.length < 2 || groupNodes.length > 100) continue;

    const lbs = groupNodes.filter((node) => node.type === NodeType.LOAD_BALANCER);
    const computes = groupNodes.filter((node) =>
      [NodeType.VM, NodeType.CONTAINER].includes(node.type as NodeType),
    );

    for (const lb of lbs) {
      for (const compute of computes) {
        if (lb.id === compute.id) continue;
        edges.push({
          source: lb.id,
          target: compute.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.75,
          inferenceMethod: 'network_subnet',
          metadata: { detectedBy: 'network_subnet' },
        });
      }
    }
  }

  for (const groupNodes of vpcMap.values()) {
    if (groupNodes.length < 2 || groupNodes.length > 200) continue;

    const computes = groupNodes.filter((node) =>
      [NodeType.VM, NodeType.CONTAINER, NodeType.APPLICATION, NodeType.MICROSERVICE].includes(
        node.type as NodeType,
      ),
    );
    const dbs = groupNodes.filter((node) =>
      [NodeType.DATABASE, NodeType.CACHE].includes(node.type as NodeType),
    );

    for (const compute of computes) {
      for (const db of dbs) {
        if (compute.id === db.id) continue;
        const alreadyInferred = edges.some(
          (edge) => edge.source === compute.id && edge.target === db.id,
        );
        if (alreadyInferred) continue;
        edges.push({
          source: compute.id,
          target: db.id,
          type: EdgeType.CONNECTS_TO,
          confidence: 0.5,
          inferenceMethod: 'network_vpc',
          metadata: { detectedBy: 'network_vpc' },
        });
      }
    }
  }

  return edges;
}

function inferFromTags(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const appGroups = new Map<string, InfraNodeAttrs[]>();

  for (const node of nodes) {
    const appTag =
      node.tags?.app || node.tags?.application || node.tags?.service || node.tags?.project;
    if (!appTag) continue;
    const key = appTag.trim().toLowerCase();
    if (!appGroups.has(key)) appGroups.set(key, []);
    appGroups.get(key)!.push(node);
  }

  for (const groupNodes of appGroups.values()) {
    const lbs = groupNodes.filter((node) => node.type === NodeType.LOAD_BALANCER);
    const computes = groupNodes.filter((node) =>
      [
        NodeType.VM,
        NodeType.CONTAINER,
        NodeType.SERVERLESS,
        NodeType.APPLICATION,
        NodeType.MICROSERVICE,
      ].includes(node.type as NodeType),
    );
    const dbs = groupNodes.filter((node) =>
      [NodeType.DATABASE, NodeType.CACHE].includes(node.type as NodeType),
    );
    const queues = groupNodes.filter((node) => node.type === NodeType.MESSAGE_QUEUE);

    for (const lb of lbs) {
      for (const compute of computes) {
        if (lb.id === compute.id) continue;
        edges.push({
          source: lb.id,
          target: compute.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.8,
          inferenceMethod: 'tags',
          metadata: { detectedBy: 'tags' },
        });
      }
    }

    for (const compute of computes) {
      for (const db of dbs) {
        if (compute.id === db.id) continue;
        edges.push({
          source: compute.id,
          target: db.id,
          type: EdgeType.CONNECTS_TO,
          confidence: 0.7,
          inferenceMethod: 'tags',
          metadata: { detectedBy: 'tags' },
        });
      }

      for (const queue of queues) {
        if (compute.id === queue.id) continue;
        edges.push({
          source: compute.id,
          target: queue.id,
          type: EdgeType.PUBLISHES_TO,
          confidence: 0.6,
          inferenceMethod: 'tags',
          metadata: { detectedBy: 'tags' },
        });
      }
    }
  }

  return edges;
}

function inferFromNaming(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const baseNameGroups = new Map<string, InfraNodeAttrs[]>();

  for (const node of nodes) {
    const baseName = extractBaseName(node.name);
    if (!baseName) continue;
    if (!baseNameGroups.has(baseName)) baseNameGroups.set(baseName, []);
    baseNameGroups.get(baseName)!.push(node);
  }

  for (const groupNodes of baseNameGroups.values()) {
    if (groupNodes.length < 2) continue;

    const computes = groupNodes.filter((node) =>
      [
        NodeType.VM,
        NodeType.CONTAINER,
        NodeType.APPLICATION,
        NodeType.MICROSERVICE,
        NodeType.SERVERLESS,
      ].includes(node.type as NodeType),
    );
    const dbs = groupNodes.filter((node) =>
      [NodeType.DATABASE, NodeType.CACHE].includes(node.type as NodeType),
    );
    const lbs = groupNodes.filter((node) => node.type === NodeType.LOAD_BALANCER);
    const queues = groupNodes.filter((node) => node.type === NodeType.MESSAGE_QUEUE);

    for (const compute of computes) {
      for (const db of dbs) {
        if (compute.id === db.id) continue;
        edges.push({
          source: compute.id,
          target: db.id,
          type: EdgeType.CONNECTS_TO,
          confidence: 0.5,
          inferenceMethod: 'naming',
          metadata: { detectedBy: 'naming' },
        });
      }
      for (const queue of queues) {
        if (compute.id === queue.id) continue;
        edges.push({
          source: compute.id,
          target: queue.id,
          type: EdgeType.PUBLISHES_TO,
          confidence: 0.4,
          inferenceMethod: 'naming',
          metadata: { detectedBy: 'naming' },
        });
      }
    }

    for (const lb of lbs) {
      for (const compute of computes) {
        if (lb.id === compute.id) continue;
        edges.push({
          source: lb.id,
          target: compute.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.5,
          inferenceMethod: 'naming',
          metadata: { detectedBy: 'naming' },
        });
      }
    }
  }

  return edges;
}

function extractBaseName(name: string): string | null {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9-_]/g, '');
  const suffixes = [
    '-api',
    '-app',
    '-web',
    '-srv',
    '-svc',
    '-service',
    '-db',
    '-database',
    '-cache',
    '-redis',
    '-pg',
    '-mysql',
    '-mongo',
    '-lb',
    '-alb',
    '-nlb',
    '-elb',
    '-balancer',
    '-worker',
    '-queue',
    '-mq',
    '-sqs',
    '-sns',
    '-primary',
    '-replica',
    '-read',
    '-write',
    '-prod',
    '-staging',
    '-dev',
    '-test',
    '-01',
    '-02',
    '-1',
    '-2',
  ];

  let base = cleaned;
  for (const suffix of suffixes) {
    if (!base.endsWith(suffix)) continue;
    base = base.slice(0, -suffix.length);
    break;
  }

  return base.length >= 3 ? base : null;
}

function inferFromPatterns(nodes: InfraNodeAttrs[], existingEdges: ScanEdge[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const existingEdgeSet = new Set(existingEdges.map((edge) => `${edge.source}->${edge.target}`));

  const apiGateways = nodes.filter((node) => node.type === NodeType.API_GATEWAY);
  const lambdas = nodes.filter((node) => node.type === NodeType.SERVERLESS);

  for (const gw of apiGateways) {
    for (const lambda of lambdas) {
      if (gw.id === lambda.id) continue;
      if (gw.region !== lambda.region) continue;
      if (existingEdgeSet.has(`${gw.id}->${lambda.id}`)) continue;
      edges.push({
        source: gw.id,
        target: lambda.id,
        type: EdgeType.ROUTES_TO,
        confidence: 0.6,
        inferenceMethod: 'pattern',
        metadata: { detectedBy: 'pattern' },
      });
    }
  }

  const cdns = nodes.filter((node) => node.type === NodeType.CDN);
  const lbs = nodes.filter((node) => node.type === NodeType.LOAD_BALANCER);

  for (const cdn of cdns) {
    for (const lb of lbs) {
      if (cdn.id === lb.id) continue;
      if (existingEdgeSet.has(`${cdn.id}->${lb.id}`)) continue;
      edges.push({
        source: cdn.id,
        target: lb.id,
        type: EdgeType.ROUTES_TO,
        confidence: 0.5,
        inferenceMethod: 'pattern',
        metadata: { detectedBy: 'pattern' },
      });
    }
  }

  const vpcs = nodes.filter((node) => node.type === NodeType.VPC);
  const subnets = nodes.filter((node) => node.type === NodeType.SUBNET);
  const vms = nodes.filter((node) =>
    [NodeType.VM, NodeType.CONTAINER, NodeType.DATABASE].includes(node.type as NodeType),
  );

  for (const vpc of vpcs) {
    for (const subnet of subnets) {
      const subnetMeta = readRecord(subnet.metadata) || {};
      const sameVpc = readString(subnetMeta.vpcId) === (readString(vpc.externalId) || vpc.id);
      if (!sameVpc) continue;
      if (existingEdgeSet.has(`${vpc.id}->${subnet.id}`)) continue;
      edges.push({
        source: vpc.id,
        target: subnet.id,
        type: EdgeType.CONTAINS,
        confidence: 0.9,
        inferenceMethod: 'pattern',
        metadata: { detectedBy: 'pattern' },
      });
    }
  }

  for (const subnet of subnets) {
    const subnetExternalId = readString(subnet.externalId) || subnet.id;
    for (const vm of vms) {
      const vmMeta = readRecord(vm.metadata) || {};
      const sameSubnet = readString(vmMeta.subnetId) === subnetExternalId;
      if (!sameSubnet) continue;
      if (existingEdgeSet.has(`${vm.id}->${subnet.id}`)) continue;
      edges.push({
        source: vm.id,
        target: subnet.id,
        type: EdgeType.RUNS_ON,
        confidence: 0.9,
        inferenceMethod: 'pattern',
        metadata: { detectedBy: 'pattern' },
      });
    }
  }

  return edges;
}

// =====================================================
//  DEDUPLICATION
// =====================================================

function mergeDetectedBy(previous: unknown, next: unknown): string[] {
  const result = new Set<string>();

  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const detectedBy = readString(item);
        if (detectedBy) result.add(detectedBy);
      }
      return;
    }
    const single = readString(value);
    if (single) result.add(single);
  };

  collect(previous);
  collect(next);

  return Array.from(result);
}

function mergeMetadata(
  first: Record<string, unknown> | undefined,
  second: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!first && !second) return undefined;
  const left = first || {};
  const right = second || {};
  const detectedBy = mergeDetectedBy(left.detectedBy, right.detectedBy);
  return {
    ...left,
    ...right,
    ...(detectedBy.length > 0 ? { detectedBy } : {}),
  };
}

function normalizeInferredEdge(edge: ScanEdge): ScanEdge | null {
  if (!readString(edge.source) || !readString(edge.target)) return null;
  if (!readString(edge.type)) return null;
  if (edge.source === edge.target) return null;

  const baseMetadata = readRecord(edge.metadata) || {};
  const detectedBy = mergeDetectedBy(baseMetadata.detectedBy, edge.inferenceMethod);

  const normalizedMetadata = {
    ...baseMetadata,
    ...(detectedBy.length > 0 ? { detectedBy } : {}),
  };

  return {
    source: edge.source,
    target: edge.target,
    type: edge.type,
    confidence: Number.isFinite(edge.confidence) ? Number(edge.confidence) : 0.8,
    provenance: 'inferred',
    ...(edge.inferenceMethod ? { inferenceMethod: edge.inferenceMethod } : {}),
    ...(Object.keys(normalizedMetadata).length > 0 ? { metadata: normalizedMetadata } : {}),
  };
}

function deduplicateEdges(existing: ScanEdge[], inferred: ScanEdge[]): ScanEdge[] {
  const existingKeys = new Set(
    existing.map((edge) => `${edge.source}->${edge.target}:${edge.type}`),
  );
  const resultByKey = new Map<string, ScanEdge>();

  for (const rawEdge of inferred) {
    const edge = normalizeInferredEdge(rawEdge);
    if (!edge) continue;

    const key = `${edge.source}->${edge.target}:${edge.type}`;
    if (existingKeys.has(key)) continue;

    const previous = resultByKey.get(key);
    if (!previous) {
      resultByKey.set(key, edge);
      continue;
    }

    const mergedMetadata = mergeMetadata(
      previous.metadata as Record<string, unknown> | undefined,
      edge.metadata,
    );
    resultByKey.set(key, {
      ...previous,
      confidence: Math.max(previous.confidence || 0, edge.confidence || 0),
      ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
    });
  }

  return Array.from(resultByKey.values());
}
