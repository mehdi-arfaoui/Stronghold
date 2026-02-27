import type { InfraNodeAttrs, ScanEdge } from './types.js';
import { EdgeType } from './types.js';

type InferenceRule = {
  sourceTypes: string[];
  targetTypes: string[];
  edgeType: string;
  confidence: number;
  rationale: string;
};

const COMMON_ARCHITECTURE_PATTERNS: InferenceRule[] = [
  {
    sourceTypes: ['ec2', 'vm', 'compute', 'ecs', 'eks', 'aks', 'gke', 'appservice', 'cloudrun', 'application', 'microservice'],
    targetTypes: ['rds', 'aurora', 'sqldatabase', 'cloudsql', 'postgresql', 'mysql', 'database'],
    edgeType: EdgeType.NETWORK_ACCESS,
    confidence: 0.85,
    rationale: 'Pattern courant: compute vers base relationnelle',
  },
  {
    sourceTypes: ['ec2', 'vm', 'compute', 'ecs', 'eks', 'aks', 'gke', 'appservice', 'cloudrun', 'application', 'microservice'],
    targetTypes: ['elasticache', 'redis', 'memorystore', 'cache'],
    edgeType: EdgeType.NETWORK_ACCESS,
    confidence: 0.8,
    rationale: 'Pattern courant: compute vers cache',
  },
  {
    sourceTypes: ['ec2', 'vm', 'compute', 'ecs', 'lambda', 'function', 'cloudfunction', 'application', 'microservice'],
    targetTypes: ['dynamodb', 'cosmosdb', 'firestore', 'bigtable', 'nosql'],
    edgeType: EdgeType.NETWORK_ACCESS,
    confidence: 0.75,
    rationale: 'Pattern courant: compute vers NoSQL',
  },
  {
    sourceTypes: ['sqs', 'servicebus', 'pubsub', 'cloudtasks', 'queue'],
    targetTypes: ['lambda', 'function', 'cloudfunction', 'serverless'],
    edgeType: EdgeType.TRIGGERS,
    confidence: 0.9,
    rationale: 'Pattern event-driven: queue declenche serverless',
  },
  {
    sourceTypes: ['lambda', 'function', 'cloudfunction', 'serverless'],
    targetTypes: ['sqs', 'servicebus', 'pubsub', 'queue'],
    edgeType: EdgeType.USES,
    confidence: 0.7,
    rationale: 'Pattern courant: serverless publie vers queue',
  },
  {
    sourceTypes: ['sns', 'eventgrid', 'eventhub', 'topic'],
    targetTypes: ['lambda', 'function', 'sqs', 'servicebus', 'queue'],
    edgeType: EdgeType.PUBLISHES_TO_APPLICATIVE,
    confidence: 0.85,
    rationale: 'Pattern pub/sub: topic vers abonnes',
  },
  {
    sourceTypes: ['sqs', 'servicebus', 'queue'],
    targetTypes: ['sqs', 'servicebus', 'queue'],
    edgeType: EdgeType.DEAD_LETTER,
    confidence: 0.6,
    rationale: 'Pattern possible: redrive policy vers DLQ',
  },
  {
    sourceTypes: ['alb', 'nlb', 'elb', 'applicationgateway', 'frontdoor', 'httploadbalancer', 'load_balancer', 'api_gateway'],
    targetTypes: ['ec2', 'vm', 'compute', 'ecs', 'eks', 'aks', 'gke', 'appservice', 'application', 'microservice'],
    edgeType: EdgeType.NETWORK_ACCESS,
    confidence: 0.9,
    rationale: 'Pattern standard: load balancer vers compute',
  },
  {
    sourceTypes: ['ec2', 'vm', 'compute', 'lambda', 'function', 'application', 'microservice'],
    targetTypes: ['s3', 'storageaccount', 'cloudstorage', 'object_storage'],
    edgeType: EdgeType.USES,
    confidence: 0.6,
    rationale: 'Pattern courant: compute vers stockage objet',
  },
];

function normalizeText(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function nodeSearchText(node: InfraNodeAttrs): string {
  const metadata =
    node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
      ? (node.metadata as Record<string, unknown>)
      : {};
  const sourceType = normalizeText(metadata.sourceType);
  const awsService = normalizeText(metadata.awsService);
  const subType = normalizeText(metadata.subType);
  return `${normalizeText(node.type)} ${sourceType} ${awsService} ${subType} ${normalizeText(node.name)} ${normalizeText(node.id)}`.trim();
}

function matchesType(nodeText: string, candidates: string[]): boolean {
  return candidates.some((candidate) => nodeText.includes(normalizeText(candidate)));
}

function isSamePlacement(source: InfraNodeAttrs, target: InfraNodeAttrs): boolean {
  if (source.region && target.region && source.region !== target.region) return false;
  const sourceMetadata =
    source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
      ? (source.metadata as Record<string, unknown>)
      : {};
  const targetMetadata =
    target.metadata && typeof target.metadata === 'object' && !Array.isArray(target.metadata)
      ? (target.metadata as Record<string, unknown>)
      : {};
  const sourceVpc = String(sourceMetadata.vpcId || '').trim();
  const targetVpc = String(targetMetadata.vpcId || '').trim();
  if (sourceVpc && targetVpc && sourceVpc !== targetVpc) return false;
  return true;
}

function edgeKey(sourceId: string, targetId: string, edgeType: string): string {
  return `${sourceId}->${targetId}:${edgeType}`;
}

export function inferBestEffortEdges(
  nodes: InfraNodeAttrs[],
  existingEdges: ScanEdge[],
): ScanEdge[] {
  const nodeTextById = new Map(nodes.map((node) => [node.id, nodeSearchText(node)]));
  const existing = new Set(existingEdges.map((edge) => edgeKey(edge.source, edge.target, edge.type)));
  const inferred: ScanEdge[] = [];
  const inferredKeys = new Set<string>();

  for (const rule of COMMON_ARCHITECTURE_PATTERNS) {
    const sources = nodes.filter((node) => matchesType(nodeTextById.get(node.id) || '', rule.sourceTypes));
    const targets = nodes.filter((node) => matchesType(nodeTextById.get(node.id) || '', rule.targetTypes));

    for (const source of sources) {
      for (const target of targets) {
        if (source.id === target.id) continue;
        if (!isSamePlacement(source, target)) continue;

        if (rule.edgeType === EdgeType.DEAD_LETTER) {
          const targetName = `${target.name} ${target.id}`.toLowerCase();
          if (!targetName.includes('dlq') && !targetName.includes('dead') && !targetName.includes('error')) {
            continue;
          }
        }

        const key = edgeKey(source.id, target.id, rule.edgeType);
        if (existing.has(key) || inferredKeys.has(key)) continue;

        inferred.push({
          source: source.id,
          target: target.id,
          type: rule.edgeType,
          confidence: rule.confidence,
          inferenceMethod: 'best_effort',
          metadata: {
            inferredBy: 'best_effort',
            confidence: rule.confidence,
            rationale: rule.rationale,
            detectedBy: ['best_effort'],
          },
        });
        inferredKeys.add(key);
      }
    }
  }

  return inferred;
}

