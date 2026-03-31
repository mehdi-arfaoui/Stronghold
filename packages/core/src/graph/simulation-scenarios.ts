/**
 * Scenario application — resolves simulation scenarios into
 * affected node IDs by region, AZ, type, or custom selection.
 */

import type { InfraNodeAttrs, SimulationScenario, ScenarioTemplate } from '../types/index.js';
import { NodeType } from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: 'region_loss',
    name: 'Complete Region Loss',
    description: 'Simulates total loss of a cloud region (e.g., AWS eu-west-1)',
    icon: 'globe',
    params: [{ name: 'region', type: 'select', options: 'dynamic_from_graph' }],
  },
  {
    id: 'az_loss',
    name: 'Availability Zone Loss',
    description: 'Simulates loss of a single AZ (e.g., eu-west-1a)',
    icon: 'building',
    params: [{ name: 'az', type: 'select', options: 'dynamic_from_graph' }],
  },
  {
    id: 'ransomware',
    name: 'Ransomware Attack',
    description: 'Simulates encryption of all servers of a given type/tag',
    icon: 'lock',
    params: [
      { name: 'targetType', type: 'select', options: Object.values(NodeType) },
      { name: 'targetTag', type: 'string', optional: true },
    ],
  },
  {
    id: 'database_failure',
    name: 'Database Failure',
    description: 'Simulates failure of one or more databases',
    icon: 'database',
    params: [{ name: 'databases', type: 'multi_select', options: 'dynamic_databases' }],
  },
  {
    id: 'network_partition',
    name: 'Network Partition',
    description: 'Simulates loss of connectivity between two VPCs/subnets',
    icon: 'plug',
    params: [
      { name: 'vpcA', type: 'select', options: 'dynamic_vpcs' },
      { name: 'vpcB', type: 'select', options: 'dynamic_vpcs' },
    ],
  },
  {
    id: 'third_party_outage',
    name: 'Third-Party Service Outage',
    description: 'Simulates unavailability of an external service (API, SaaS)',
    icon: 'cloud',
    params: [{ name: 'service', type: 'select', options: 'dynamic_third_party' }],
  },
  {
    id: 'dns_failure',
    name: 'DNS Failure',
    description: 'Simulates a DNS service failure',
    icon: 'signal',
    params: [],
  },
  {
    id: 'custom',
    name: 'Custom Scenario',
    description: 'Manually select nodes to disable',
    icon: 'crosshair',
    params: [{ name: 'nodes', type: 'multi_select', options: 'dynamic_all_nodes' }],
  },
];

export function applyScenario(graph: GraphInstance, scenario: SimulationScenario): string[] {
  const params = scenario.params;
  switch (scenario.scenarioType) {
    case 'region_loss':
      return removeNodesByRegion(graph, params.region as string);
    case 'az_loss':
      return removeNodesByAZ(graph, params.az as string);
    case 'ransomware':
      return removeNodesForRansomware(
        graph,
        params.targetType as string | undefined,
        params.targetTypes as unknown,
        params.targetTag as string | undefined,
      );
    case 'database_failure':
      return params.databases as string[];
    case 'network_partition':
      return removeEdgesBetween(graph, params.vpcA as string, params.vpcB as string);
    case 'third_party_outage':
      return [params.service as string];
    case 'dns_failure':
      return removeNodesByType(graph, NodeType.DNS);
    case 'custom':
      return (params.nodes as string[]) || [];
    default:
      return [];
  }
}

function removeNodesByRegion(graph: GraphInstance, region: string): string[] {
  const affected: string[] = [];
  graph.forEachNode((nodeId, rawAttrs) => {
    if ((rawAttrs as unknown as InfraNodeAttrs).region === region) affected.push(nodeId);
  });
  return affected;
}

function removeNodesByAZ(graph: GraphInstance, az: string): string[] {
  const affected: string[] = [];
  graph.forEachNode((nodeId, rawAttrs) => {
    if ((rawAttrs as unknown as InfraNodeAttrs).availabilityZone === az) affected.push(nodeId);
  });
  return affected;
}

function removeNodesByType(graph: GraphInstance, type: string): string[] {
  const affected: string[] = [];
  graph.forEachNode((nodeId, rawAttrs) => {
    if ((rawAttrs as unknown as InfraNodeAttrs).type === type) affected.push(nodeId);
  });
  return affected;
}

function normalizeRansomwareTargetTypes(
  targetType: string | undefined,
  targetTypes: unknown,
): string[] {
  const normalized = new Set<string>();
  if (typeof targetType === 'string' && targetType.trim().length > 0)
    normalized.add(targetType.trim().toUpperCase());
  if (Array.isArray(targetTypes)) {
    for (const entry of targetTypes) {
      if (typeof entry !== 'string') continue;
      const val = entry.trim().toUpperCase();
      if (val.length > 0) normalized.add(val);
    }
  }
  return normalized.size > 0
    ? Array.from(normalized)
    : ['DATABASE', 'OBJECT_STORAGE', 'FILE_STORAGE', 'VM'];
}

function removeNodesForRansomware(
  graph: GraphInstance,
  targetType: string | undefined,
  targetTypes: unknown,
  targetTag?: string,
): string[] {
  const targets = normalizeRansomwareTargetTypes(targetType, targetTypes);
  const impacted = removeNodesByTypesOrTag(graph, targets, targetTag);
  if (impacted.length > 0) return impacted;
  return removeNodesByTypesOrTag(graph, [
    'DATABASE',
    'OBJECT_STORAGE',
    'FILE_STORAGE',
    'VM',
    'APPLICATION',
    'MICROSERVICE',
  ]);
}

function removeNodesByTypesOrTag(
  graph: GraphInstance,
  targetTypes: string[],
  targetTag?: string,
): string[] {
  const affected: string[] = [];
  const types = new Set(
    targetTypes
      .map((e) =>
        String(e || '')
          .trim()
          .toUpperCase(),
      )
      .filter((e) => e.length > 0),
  );
  if (types.size === 0) return affected;
  graph.forEachNode((nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    const typeMatch = types.has(String(a.type || '').toUpperCase());
    const tagMatch = targetTag ? Object.values(a.tags || {}).some((v) => v === targetTag) : true;
    if (typeMatch && tagMatch) affected.push(nodeId);
  });
  return affected;
}

function removeEdgesBetween(graph: GraphInstance, vpcA: string, vpcB: string): string[] {
  const nodesA = new Set<string>();
  const nodesB = new Set<string>();
  graph.forEachNode((nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    const vpc = (a.metadata?.vpcId as string) || '';
    if (vpc === vpcA || nodeId === vpcA) nodesA.add(nodeId);
    if (vpc === vpcB || nodeId === vpcB) nodesB.add(nodeId);
  });
  const affected: string[] = [];
  const edgesToRemove: string[] = [];
  graph.forEachEdge((edgeKey, _attrs, source, target) => {
    if ((nodesA.has(source) && nodesB.has(target)) || (nodesB.has(source) && nodesA.has(target))) {
      edgesToRemove.push(edgeKey);
      affected.push(target);
    }
  });
  for (const ek of edgesToRemove) {
    if (graph.hasEdge(ek)) graph.dropEdge(ek);
  }
  return [...new Set(affected)];
}

export function getScenarioOptions(graph: GraphInstance): Record<string, string[]> {
  const regions = new Set<string>();
  const azs = new Set<string>();
  const databases: string[] = [];
  const vpcs: string[] = [];
  const thirdParty: string[] = [];
  const allNodes: string[] = [];
  graph.forEachNode((nodeId, rawAttrs) => {
    const a = rawAttrs as unknown as InfraNodeAttrs;
    allNodes.push(nodeId);
    if (a.region) regions.add(a.region);
    if (a.availabilityZone) azs.add(a.availabilityZone);
    if (a.type === NodeType.DATABASE) databases.push(nodeId);
    if (a.type === NodeType.VPC) vpcs.push(nodeId);
    if (a.type === NodeType.THIRD_PARTY_API || a.type === NodeType.SAAS_SERVICE)
      thirdParty.push(nodeId);
  });
  return {
    regions: Array.from(regions),
    azs: Array.from(azs),
    databases,
    vpcs,
    thirdParty,
    allNodes,
  };
}
