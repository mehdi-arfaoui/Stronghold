// ============================================================
// DependencyInferenceEngine — Infer missing dependencies
// ============================================================

import type { InfraNodeAttrs, ScanEdge } from './types.js';
import { NodeType, EdgeType } from './types.js';

/**
 * Infer dependencies that are not explicitly provided by cloud APIs.
 *
 * Strategies (by reliability):
 * 1. Security Groups (same SG = communication)
 * 2. Network (same subnet = probable connection)
 * 3. Tags (same "app"/"service" tag = same application)
 * 4. Naming conventions (e.g., "payment-api" and "payment-db")
 * 5. Architectural patterns (LB in front of compute, compute connects to DB)
 */
export function inferDependencies(
  nodes: InfraNodeAttrs[],
  existingEdges: ScanEdge[]
): ScanEdge[] {
  const inferred: ScanEdge[] = [];

  inferred.push(...inferFromSecurityGroups(nodes));
  inferred.push(...inferFromNetwork(nodes));
  inferred.push(...inferFromTags(nodes));
  inferred.push(...inferFromNaming(nodes));
  inferred.push(...inferFromPatterns(nodes, existingEdges));

  return deduplicateEdges(existingEdges, inferred);
}

// =====================================================
//  STRATEGY 1: SECURITY GROUPS
// =====================================================

/**
 * If two nodes share the same security group, or if one SG allows
 * traffic from another, they likely communicate.
 */
function inferFromSecurityGroups(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const sgMap = new Map<string, InfraNodeAttrs[]>();

  // Group nodes by their security groups
  for (const node of nodes) {
    const sgs: string[] = node.metadata?.securityGroups as string[] || [];
    for (const sg of sgs) {
      if (!sgMap.has(sg)) sgMap.set(sg, []);
      sgMap.get(sg)!.push(node);
    }
  }

  // Nodes in the same SG likely communicate
  for (const [_sg, groupNodes] of sgMap) {
    if (groupNodes.length < 2 || groupNodes.length > 50) continue; // skip overly broad SGs

    // Create edges from compute → data tier within same SG
    const computes = groupNodes.filter(n =>
      [NodeType.VM, NodeType.CONTAINER, NodeType.SERVERLESS, NodeType.APPLICATION, NodeType.MICROSERVICE]
        .includes(n.type as NodeType)
    );
    const dataNodes = groupNodes.filter(n =>
      [NodeType.DATABASE, NodeType.CACHE, NodeType.MESSAGE_QUEUE]
        .includes(n.type as NodeType)
    );

    for (const compute of computes) {
      for (const data of dataNodes) {
        edges.push({
          source: compute.id,
          target: data.id,
          type: EdgeType.CONNECTS_TO,
          confidence: 0.85,
          inferenceMethod: 'security_group',
        });
      }
    }
  }

  return edges;
}

// =====================================================
//  STRATEGY 2: NETWORK (same VPC / subnet)
// =====================================================

/**
 * Nodes in the same VPC and subnet are likely connected.
 * Higher confidence for same-subnet, lower for same-VPC-different-subnet.
 */
function inferFromNetwork(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const subnetMap = new Map<string, InfraNodeAttrs[]>();
  const vpcMap = new Map<string, InfraNodeAttrs[]>();

  for (const node of nodes) {
    const subnetId = node.metadata?.subnetId as string | undefined;
    const vpcId = node.metadata?.vpcId as string | undefined;

    if (subnetId) {
      if (!subnetMap.has(subnetId)) subnetMap.set(subnetId, []);
      subnetMap.get(subnetId)!.push(node);
    }
    if (vpcId) {
      if (!vpcMap.has(vpcId)) vpcMap.set(vpcId, []);
      vpcMap.get(vpcId)!.push(node);
    }
  }

  // Same subnet → high confidence connection
  for (const [_subnet, groupNodes] of subnetMap) {
    if (groupNodes.length < 2 || groupNodes.length > 100) continue;

    const lbs = groupNodes.filter(n => n.type === NodeType.LOAD_BALANCER);
    const computes = groupNodes.filter(n =>
      [NodeType.VM, NodeType.CONTAINER].includes(n.type as NodeType)
    );

    // LB in same subnet as compute → ROUTES_TO
    for (const lb of lbs) {
      for (const compute of computes) {
        edges.push({
          source: lb.id,
          target: compute.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.75,
          inferenceMethod: 'network_subnet',
        });
      }
    }
  }

  // Same VPC → lower confidence, only for specific patterns
  for (const [_vpc, groupNodes] of vpcMap) {
    if (groupNodes.length < 2 || groupNodes.length > 200) continue;

    const computes = groupNodes.filter(n =>
      [NodeType.VM, NodeType.CONTAINER, NodeType.APPLICATION, NodeType.MICROSERVICE]
        .includes(n.type as NodeType)
    );
    const dbs = groupNodes.filter(n =>
      [NodeType.DATABASE, NodeType.CACHE].includes(n.type as NodeType)
    );

    // Compute in same VPC as DB → probable CONNECTS_TO (lower confidence than subnet)
    for (const compute of computes) {
      for (const db of dbs) {
        // Only if not already inferred at subnet level
        const alreadyInferred = edges.some(
          e => e.source === compute.id && e.target === db.id
        );
        if (!alreadyInferred) {
          edges.push({
            source: compute.id,
            target: db.id,
            type: EdgeType.CONNECTS_TO,
            confidence: 0.5,
            inferenceMethod: 'network_vpc',
          });
        }
      }
    }
  }

  return edges;
}

// =====================================================
//  STRATEGY: TAGS
// =====================================================

function inferFromTags(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const appGroups = new Map<string, InfraNodeAttrs[]>();

  // Group by app/service/project tag
  for (const node of nodes) {
    const appTag = node.tags?.app || node.tags?.application ||
      node.tags?.service || node.tags?.project;
    if (appTag) {
      if (!appGroups.has(appTag)) appGroups.set(appTag, []);
      appGroups.get(appTag)!.push(node);
    }
  }

  for (const [_app, groupNodes] of appGroups) {
    const lbs = groupNodes.filter(n => n.type === NodeType.LOAD_BALANCER);
    const computes = groupNodes.filter(n =>
      [NodeType.VM, NodeType.CONTAINER, NodeType.SERVERLESS, NodeType.APPLICATION, NodeType.MICROSERVICE]
        .includes(n.type as NodeType)
    );
    const dbs = groupNodes.filter(n =>
      [NodeType.DATABASE, NodeType.CACHE].includes(n.type as NodeType)
    );
    const queues = groupNodes.filter(n => n.type === NodeType.MESSAGE_QUEUE);

    // LB → Compute
    for (const lb of lbs) {
      for (const compute of computes) {
        edges.push({
          source: lb.id,
          target: compute.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.8,
          inferenceMethod: 'tags',
        });
      }
    }

    // Compute → DB
    for (const compute of computes) {
      for (const db of dbs) {
        edges.push({
          source: compute.id,
          target: db.id,
          type: EdgeType.CONNECTS_TO,
          confidence: 0.7,
          inferenceMethod: 'tags',
        });
      }
    }

    // Compute → Queue
    for (const compute of computes) {
      for (const queue of queues) {
        edges.push({
          source: compute.id,
          target: queue.id,
          type: EdgeType.PUBLISHES_TO,
          confidence: 0.6,
          inferenceMethod: 'tags',
        });
      }
    }
  }

  return edges;
}

// =====================================================
//  STRATEGY: NAMING CONVENTIONS
// =====================================================

function inferFromNaming(nodes: InfraNodeAttrs[]): ScanEdge[] {
  const edges: ScanEdge[] = [];

  // Extract base names (e.g., "payment-api" → "payment", "payment-db" → "payment")
  const baseNameGroups = new Map<string, InfraNodeAttrs[]>();

  for (const node of nodes) {
    const baseName = extractBaseName(node.name);
    if (baseName) {
      if (!baseNameGroups.has(baseName)) baseNameGroups.set(baseName, []);
      baseNameGroups.get(baseName)!.push(node);
    }
  }

  for (const [_baseName, groupNodes] of baseNameGroups) {
    if (groupNodes.length < 2) continue;

    // Within each naming group, infer typical patterns
    const computes = groupNodes.filter(n =>
      [NodeType.VM, NodeType.CONTAINER, NodeType.APPLICATION, NodeType.MICROSERVICE, NodeType.SERVERLESS]
        .includes(n.type as NodeType)
    );
    const dbs = groupNodes.filter(n =>
      [NodeType.DATABASE, NodeType.CACHE].includes(n.type as NodeType)
    );
    const lbs = groupNodes.filter(n => n.type === NodeType.LOAD_BALANCER);
    const queues = groupNodes.filter(n => n.type === NodeType.MESSAGE_QUEUE);

    for (const compute of computes) {
      for (const db of dbs) {
        edges.push({
          source: compute.id,
          target: db.id,
          type: EdgeType.CONNECTS_TO,
          confidence: 0.5,
          inferenceMethod: 'naming',
        });
      }
      for (const queue of queues) {
        edges.push({
          source: compute.id,
          target: queue.id,
          type: EdgeType.PUBLISHES_TO,
          confidence: 0.4,
          inferenceMethod: 'naming',
        });
      }
    }

    for (const lb of lbs) {
      for (const compute of computes) {
        edges.push({
          source: lb.id,
          target: compute.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.5,
          inferenceMethod: 'naming',
        });
      }
    }
  }

  return edges;
}

function extractBaseName(name: string): string | null {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9-_]/g, '');
  // Common suffixes to strip
  const suffixes = [
    '-api', '-app', '-web', '-srv', '-svc', '-service',
    '-db', '-database', '-cache', '-redis', '-pg', '-mysql', '-mongo',
    '-lb', '-alb', '-nlb', '-elb', '-balancer',
    '-worker', '-queue', '-mq', '-sqs', '-sns',
    '-primary', '-replica', '-read', '-write',
    '-prod', '-staging', '-dev', '-test',
    '-01', '-02', '-1', '-2',
  ];

  let base = cleaned;
  for (const suffix of suffixes) {
    if (base.endsWith(suffix)) {
      base = base.slice(0, -suffix.length);
      break;
    }
  }

  return base.length >= 3 ? base : null;
}

// =====================================================
//  STRATEGY: ARCHITECTURAL PATTERNS
// =====================================================

function inferFromPatterns(
  nodes: InfraNodeAttrs[],
  existingEdges: ScanEdge[]
): ScanEdge[] {
  const edges: ScanEdge[] = [];
  const existingEdgeSet = new Set(existingEdges.map(e => `${e.source}->${e.target}`));

  // Pattern: API Gateway → Lambda (same region)
  const apiGateways = nodes.filter(n => n.type === NodeType.API_GATEWAY);
  const lambdas = nodes.filter(n => n.type === NodeType.SERVERLESS);

  for (const gw of apiGateways) {
    for (const lambda of lambdas) {
      if (gw.region === lambda.region && !existingEdgeSet.has(`${gw.id}->${lambda.id}`)) {
        edges.push({
          source: gw.id,
          target: lambda.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.6,
          inferenceMethod: 'pattern',
        });
      }
    }
  }

  // Pattern: CDN → Load Balancer (same app)
  const cdns = nodes.filter(n => n.type === NodeType.CDN);
  const lbs = nodes.filter(n => n.type === NodeType.LOAD_BALANCER);

  for (const cdn of cdns) {
    for (const lb of lbs) {
      if (!existingEdgeSet.has(`${cdn.id}->${lb.id}`)) {
        edges.push({
          source: cdn.id,
          target: lb.id,
          type: EdgeType.ROUTES_TO,
          confidence: 0.5,
          inferenceMethod: 'pattern',
        });
      }
    }
  }

  // Pattern: VPC contains subnets, subnets contain VMs
  const vpcs = nodes.filter(n => n.type === NodeType.VPC);
  const subnets = nodes.filter(n => n.type === NodeType.SUBNET);
  const vms = nodes.filter(n =>
    [NodeType.VM, NodeType.CONTAINER, NodeType.DATABASE].includes(n.type as NodeType)
  );

  for (const vpc of vpcs) {
    for (const subnet of subnets) {
      const sameVpc = (subnet.metadata?.vpcId as string) === (vpc.externalId || vpc.id);
      if (sameVpc && !existingEdgeSet.has(`${vpc.id}->${subnet.id}`)) {
        edges.push({
          source: vpc.id,
          target: subnet.id,
          type: EdgeType.CONTAINS,
          confidence: 0.9,
          inferenceMethod: 'pattern',
        });
      }
    }
  }

  for (const subnet of subnets) {
    for (const vm of vms) {
      const sameSubnet = (vm.metadata?.subnetId as string) === (subnet.externalId || subnet.id);
      if (sameSubnet && !existingEdgeSet.has(`${vm.id}->${subnet.id}`)) {
        edges.push({
          source: vm.id,
          target: subnet.id,
          type: EdgeType.RUNS_ON,
          confidence: 0.9,
          inferenceMethod: 'pattern',
        });
      }
    }
  }

  return edges;
}

// =====================================================
//  DEDUPLICATION
// =====================================================

function deduplicateEdges(existing: ScanEdge[], inferred: ScanEdge[]): ScanEdge[] {
  const existingKeys = new Set(existing.map(e => `${e.source}->${e.target}:${e.type}`));
  const seen = new Set<string>();
  const result: ScanEdge[] = [];

  for (const edge of inferred) {
    const key = `${edge.source}->${edge.target}:${edge.type}`;
    if (!existingKeys.has(key) && !seen.has(key)) {
      seen.add(key);
      result.push(edge);
    }
  }

  return result;
}
