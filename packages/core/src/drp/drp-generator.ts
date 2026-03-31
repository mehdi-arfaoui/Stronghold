import { createHash } from 'node:crypto';

import type { GraphInstance } from '../graph/index.js';
import { isAnalyzableServiceNode } from '../graph/index.js';
import { getMetadata, readNumber, readString } from '../graph/analysis-helpers.js';
import type { EnrichmentResult } from '../providers/index.js';
import { NodeType, type GraphAnalysisReport, type InfraNodeAttrs } from '../types/index.js';
import type {
  DRPComponent,
  EffectiveRTO,
  DRPService,
  DRPlan,
  InfrastructureNode,
  ValidationTest,
} from './drp-types.js';
import { determineRecoveryStrategy, generateRecoverySteps } from './recovery-strategies.js';
import {
  buildRTOEstimateInput,
  estimateRecovery,
  estimateRecoveryObjectives,
  parseDrpDuration,
} from './rto-estimator.js';

const DEFAULT_PLAN_VERSION = '1.0.0';

/** Inputs used to generate a deterministic DR plan from the current graph state. */
export interface GenerateDrPlanOptions {
  readonly graph: GraphInstance;
  readonly analysis: GraphAnalysisReport;
  readonly enrichmentResults?: readonly EnrichmentResult[];
  readonly provider?: string;
  readonly version?: string;
  readonly generatedAt?: Date;
}

/** Generates a full DRP-as-Code document from the current graph and resilience analysis. */
export function generateDrPlan(options: GenerateDrPlanOptions): DRPlan {
  const infrastructureHash = calculateInfrastructureHash(options.graph);
  const nodes = collectNodes(options.graph, options.provider);
  const serviceGroups = collectServiceGroups(nodes);
  const services = Array.from(serviceGroups.entries())
    .map(([serviceName, roots]) =>
      buildService(serviceName, roots, options.graph, options.analysis),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const coveredComponentIds = new Set(
    services.flatMap((service) => service.components.map((component) => component.resourceId)),
  );
  const uncoveredResources = nodes
    .filter(
      (node) => !coveredComponentIds.has(node.id) || determineRecoveryStrategy(node) === 'none',
    )
    .map((node) => node.id)
    .sort();

  return {
    id: `drp-${infrastructureHash.slice(0, 12)}`,
    version: options.version ?? DEFAULT_PLAN_VERSION,
    generated: (options.generatedAt ?? new Date()).toISOString(),
    infrastructureHash,
    provider: options.provider ?? inferProvider(nodes),
    regions: collectRegions(nodes),
    services,
    metadata: {
      totalResources: options.graph.order,
      coveredResources: coveredComponentIds.size,
      uncoveredResources,
      worstCaseRTO: aggregateMaxDuration(services.map((service) => service.estimatedRTO)),
      averageRPO: aggregateAverageRpo(
        services.flatMap((service) =>
          service.components.map((component) => component.estimatedRPO),
        ),
      ),
      ...(options.enrichmentResults?.some((result) => result.failed > 0)
        ? {
            stale: false,
            staleReason: `Generated with partial enrichment coverage (${options.enrichmentResults.reduce((sum, item) => sum + item.failed, 0)} enrichment failures).`,
          }
        : { stale: false }),
    },
  };
}

/** Backward-compatible alias that preserves the current DRP document shape. */
export function generateDRPlan(options: GenerateDrPlanOptions): DRPlan {
  return generateDrPlan(options);
}

/** Calculates a stable infrastructure hash from graph nodes and edges. */
export function calculateInfrastructureHash(graph: GraphInstance): string {
  const nodes = graph
    .nodes()
    .map((nodeId) => graph.getNodeAttributes(nodeId) as unknown as InfraNodeAttrs)
    .map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      provider: node.provider,
      region: node.region ?? null,
      availabilityZone: node.availabilityZone ?? null,
      tags: normalizeValue(node.tags),
      metadata: normalizeValue(node.metadata),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const edges = graph
    .edges()
    .map((edgeId) => ({
      id: edgeId,
      source: graph.source(edgeId),
      target: graph.target(edgeId),
      attrs: normalizeValue(graph.getEdgeAttributes(edgeId)),
    }))
    .sort((left, right) =>
      `${left.source}:${left.target}:${left.id}`.localeCompare(
        `${right.source}:${right.target}:${right.id}`,
      ),
    );

  return createHash('sha256').update(JSON.stringify({ nodes, edges })).digest('hex');
}

function collectNodes(graph: GraphInstance, provider?: string): InfrastructureNode[] {
  const nodes: InfrastructureNode[] = [];
  graph.forEachNode((_nodeId, rawAttrs) => {
    const node = rawAttrs as unknown as InfrastructureNode;
    if (!provider || node.provider === provider) nodes.push(node);
  });
  return nodes.sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

function collectServiceGroups(
  nodes: readonly InfrastructureNode[],
): Map<string, InfrastructureNode[]> {
  const groups = new Map<string, InfrastructureNode[]>();
  const candidates = nodes.filter((node) => isAnalyzableServiceNode(node));
  const fallback = candidates.length > 0 ? candidates : nodes;

  for (const node of fallback) {
    const key = resolveServiceGroupName(node);
    const current = groups.get(key) ?? [];
    current.push(node);
    groups.set(key, current.sort(compareByCriticality));
  }

  return groups;
}

function buildService(
  serviceName: string,
  roots: readonly InfrastructureNode[],
  graph: GraphInstance,
  analysis: GraphAnalysisReport,
): DRPService {
  const componentIds = collectComponentIds(
    graph,
    roots.map((root) => root.id),
  );
  const recoveryOrder = buildRecoveryOrder(graph, componentIds);
  const baseComponents = componentIds.map((nodeId) => buildComponent(nodeId, graph, analysis));
  const effectiveRtos = computeEffectiveRTOs(baseComponents, recoveryOrder);
  const components = baseComponents.map((component) =>
    enrichComponentWithEffectiveRTO(component, effectiveRtos.get(component.resourceId)),
  );
  const firstComponent = components[0];
  const primary =
    roots[0] ??
    (firstComponent
      ? (graph.getNodeAttributes(firstComponent.resourceId) as unknown as InfrastructureNode)
      : undefined);
  const criticality = resolveCriticality(primary);

  return {
    name: serviceName,
    criticality,
    rtoTarget: resolveRtoTarget(primary, criticality),
    rpoTarget: resolveRpoTarget(primary, criticality),
    components,
    validationTests: buildValidationTests(componentIds, graph),
    estimatedRTO: aggregateMaxDuration(components.map((component) => resolveAggregateRto(component))),
    estimatedRPO: aggregateMaxRpo(components.map((component) => component.estimatedRPO)),
    recoveryOrder,
  };
}

function buildComponent(
  nodeId: string,
  graph: GraphInstance,
  analysis: GraphAnalysisReport,
): DRPComponent {
  const node = graph.getNodeAttributes(nodeId) as unknown as InfrastructureNode;
  const strategy = determineRecoveryStrategy(node);
  const objectives = estimateRecoveryObjectives(node, strategy);
  const crossRegionContext = resolveCrossRegionContext(nodeId, graph, node.region ?? null);
  const rtoEstimate = estimateRecovery(
    buildRTOEstimateInput(node, strategy, crossRegionContext),
  );

  return {
    resourceId: node.id,
    resourceType: node.type,
    name: node.name,
    region: node.region ?? 'global',
    recoveryStrategy: strategy,
    recoverySteps: generateRecoverySteps(node, strategy),
    estimatedRTO: objectives.rto,
    estimatedRPO: objectives.rpo,
    dependencies: graph.outNeighbors(nodeId).sort(),
    risks: buildRisks(node, analysis, strategy),
    rtoEstimate,
  };
}

function enrichComponentWithEffectiveRTO(
  component: DRPComponent,
  effectiveRTO: EffectiveRTO | undefined,
): DRPComponent {
  if (!effectiveRTO) return component;

  const warnings = effectiveRTO.chainContainsUnverified
    ? [
        'Chain RTO requires testing because at least one component in the dependency chain is unverified.',
      ]
    : [];

  return {
    ...component,
    effectiveRTO,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function buildRisks(
  node: InfrastructureNode,
  analysis: GraphAnalysisReport,
  strategy: DRPComponent['recoveryStrategy'],
): readonly string[] {
  const risks = new Set<string>();
  const spof = analysis.spofs.find((item) => item.nodeId === node.id);
  const redundancy = analysis.redundancyIssues.find((item) => item.nodeId === node.id);

  if (spof) risks.add(`Single point of failure: ${spof.recommendation}`);
  if (redundancy) {
    for (const check of redundancy.failedChecks) {
      risks.add(`${check.check}: ${check.recommendation}`);
    }
  }
  if (strategy === 'manual') risks.add('Recovery requires manual intervention.');
  if (strategy === 'none') {
    risks.add('No deterministic recovery strategy could be derived from current metadata.');
  }

  return Array.from(risks).sort();
}

function buildValidationTests(
  componentIds: readonly string[],
  graph: GraphInstance,
): readonly ValidationTest[] {
  const tests: ValidationTest[] = [];
  const seen = new Set<string>();

  for (const nodeId of componentIds) {
    const node = graph.getNodeAttributes(nodeId) as unknown as InfrastructureNode;
    const metadata = getMetadata(node);
    const target =
      readString(metadata.endpointAddress) ??
      readString(metadata.configurationEndpoint) ??
      readString(metadata.primaryEndpoint) ??
      readString(metadata.bucketName) ??
      readString(metadata.tableName) ??
      readString(metadata.queueName) ??
      readString(metadata.topicName) ??
      node.name;

    const definitions: ValidationTest[] = [
      ...buildHealthChecks(node, target),
      ...buildConnectivityChecks(node, target),
      ...buildIntegrityChecks(node, target),
      ...buildDnsChecks(node, target),
    ];

    for (const test of definitions) {
      const key = `${test.type}:${test.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tests.push(test);
    }
  }

  if (tests.length > 0) return tests.sort((left, right) => left.name.localeCompare(right.name));
  return [
    {
      name: 'manual service validation',
      type: 'custom',
      target: componentIds[0] ?? 'service',
      description: 'Run the application smoke test checklist after recovery.',
      timeout: '5m',
    },
  ];
}

function buildHealthChecks(node: InfrastructureNode, target: string): readonly ValidationTest[] {
  if (![NodeType.SERVERLESS, NodeType.LOAD_BALANCER].includes(node.type as NodeType)) return [];
  return [
    {
      name: `${node.name} health`,
      type: 'health_check',
      target,
      description: `Verify ${node.name} responds after recovery.`,
      timeout: '30s',
    },
  ];
}

function buildConnectivityChecks(
  node: InfrastructureNode,
  target: string,
): readonly ValidationTest[] {
  if (
    ![NodeType.DATABASE, NodeType.CACHE, NodeType.MESSAGE_QUEUE].includes(node.type as NodeType)
  ) {
    return [];
  }
  return [
    {
      name: `${node.name} connectivity`,
      type: 'connectivity',
      target,
      description: `Verify dependency connectivity for ${node.name}.`,
      timeout: '1m',
    },
  ];
}

function buildIntegrityChecks(node: InfrastructureNode, target: string): readonly ValidationTest[] {
  if (node.type !== NodeType.OBJECT_STORAGE) return [];
  return [
    {
      name: `${node.name} data integrity`,
      type: 'data_integrity',
      target,
      description: `Verify ${node.name} data remains readable after recovery.`,
      timeout: '2m',
    },
  ];
}

function buildDnsChecks(node: InfrastructureNode, target: string): readonly ValidationTest[] {
  if (node.type !== NodeType.DNS) return [];
  return [
    {
      name: `${node.name} dns`,
      type: 'dns_resolution',
      target,
      description: `Verify DNS resolution for ${node.name}.`,
      timeout: '1m',
    },
  ];
}

function collectComponentIds(graph: GraphInstance, rootIds: readonly string[]): readonly string[] {
  const visited = new Set<string>();
  const queue = [...rootIds].sort();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current) || !graph.hasNode(current)) continue;
    visited.add(current);
    for (const dependencyId of graph.outNeighbors(current).sort()) {
      if (!visited.has(dependencyId)) queue.push(dependencyId);
    }
  }

  return Array.from(visited).sort((left, right) => left.localeCompare(right));
}

function buildRecoveryOrder(
  graph: GraphInstance,
  componentIds: readonly string[],
): readonly string[] {
  const allowed = new Set(componentIds);
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const order: string[] = [];

  const visit = (nodeId: string): void => {
    if (visited.has(nodeId) || !allowed.has(nodeId)) return;
    if (inStack.has(nodeId)) return;
    inStack.add(nodeId);
    for (const dependencyId of graph
      .outNeighbors(nodeId)
      .sort((left, right) => compareRecoveryPriority(graph, left, right))) {
      visit(dependencyId);
    }
    inStack.delete(nodeId);
    visited.add(nodeId);
    order.push(nodeId);
  };

  for (const componentId of [...componentIds].sort((left, right) =>
    compareRecoveryPriority(graph, left, right),
  )) {
    visit(componentId);
  }
  return order;
}

function computeEffectiveRTOs(
  components: readonly DRPComponent[],
  recoveryOrder: readonly string[],
): ReadonlyMap<string, EffectiveRTO> {
  const componentsById = new Map(components.map((component) => [component.resourceId, component] as const));
  const effectiveById = new Map<string, EffectiveRTO>();

  for (const nodeId of recoveryOrder) {
    const component = componentsById.get(nodeId);
    const estimate = component?.rtoEstimate;
    if (!component || !estimate) continue;

    const dependencyEffects = component.dependencies
      .map((dependencyId) => effectiveById.get(dependencyId))
      .filter((item): item is EffectiveRTO => Boolean(item));
    const unknownDependency =
      dependencyEffects.find((item) => item.chainRTOMax === null)?.bottleneck ??
      component.dependencies.find((dependencyId) => effectiveById.get(dependencyId)?.chainRTOMax === null) ??
      null;
    const chainRTOMax =
      estimate.rtoMaxMinutes === null || unknownDependency
        ? null
        : Math.max(
            estimate.rtoMaxMinutes,
            ...dependencyEffects.map((dependency) => dependency.chainRTOMax ?? 0),
          );
    const chainRTOMin =
      estimate.rtoMinMinutes === null ||
      dependencyEffects.some((dependency) => dependency.chainRTOMin === null)
        ? null
        : Math.max(
            estimate.rtoMinMinutes,
            ...dependencyEffects.map((dependency) => dependency.chainRTOMin ?? 0),
          );
    const dependencyBottleneck = dependencyEffects.reduce<{
      readonly value: number;
      readonly id: string | null;
    }>(
      (current, dependency, index) => {
        const value = dependency.chainRTOMax ?? -1;
        if (value <= current.value) return current;
        return {
          value,
          id: dependency.bottleneck ?? component.dependencies[index] ?? null,
        };
      },
      { value: -1, id: null },
    );
    const bottleneck =
      chainRTOMax === null
        ? unknownDependency
        : dependencyBottleneck.value > (estimate.rtoMaxMinutes ?? -1)
          ? dependencyBottleneck.id
          : null;

    effectiveById.set(nodeId, {
      componentRTOMin: estimate.rtoMinMinutes,
      componentRTOMax: estimate.rtoMaxMinutes,
      chainRTOMin,
      chainRTOMax,
      bottleneck,
      chainContainsUnverified:
        estimate.confidence === 'unverified' ||
        dependencyEffects.some((dependency) => dependency.chainContainsUnverified),
      assumption: 'sequential_restore',
    });
  }

  return effectiveById;
}

function resolveCrossRegionContext(
  nodeId: string,
  graph: GraphInstance,
  region: string | null,
): BuildCrossRegionContext {
  const linkedRegions = Array.from(
    new Set(
      [...graph.outNeighbors(nodeId), ...graph.inNeighbors(nodeId)]
        .map((linkedNodeId) => graph.getNodeAttributes(linkedNodeId) as unknown as InfrastructureNode)
        .map((linkedNode) => linkedNode.region ?? null)
        .filter((linkedRegion): linkedRegion is string => Boolean(linkedRegion && linkedRegion !== region)),
    ),
  );

  return {
    isMultiRegion: linkedRegions.length > 0,
    targetRegion: linkedRegions[0] ?? null,
  };
}

interface BuildCrossRegionContext {
  readonly isMultiRegion: boolean;
  readonly targetRegion: string | null;
}

function resolveAggregateRto(component: DRPComponent): string {
  if (component.effectiveRTO?.chainRTOMax !== null && component.effectiveRTO?.chainRTOMax !== undefined) {
    return formatDurationValue(component.effectiveRTO.chainRTOMax * 60);
  }
  return component.estimatedRTO;
}

function resolveServiceGroupName(node: InfrastructureNode): string {
  const metadata = getMetadata(node);
  const businessTags =
    metadata.businessTags && typeof metadata.businessTags === 'object'
      ? (metadata.businessTags as Record<string, unknown>)
      : {};

  return (
    readString(businessTags.Service) ??
    readString(businessTags['service-name']) ??
    readString(businessTags.Application) ??
    readString(node.tags.Service) ??
    readString(node.tags.application) ??
    node.name
  );
}

function resolveCriticality(node: InfrastructureNode | undefined): DRPService['criticality'] {
  const score = readNumber(node?.criticalityScore) ?? 0;
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function resolveRtoTarget(
  node: InfrastructureNode | undefined,
  criticality: DRPService['criticality'],
): string {
  const explicit = readNumber(node?.validatedRTO) ?? readNumber(node?.suggestedRTO);
  if (explicit !== null) return `${Math.max(1, Math.round(explicit))}m`;
  return { critical: '15m', high: '1h', medium: '4h', low: '24h' }[criticality];
}

function resolveRpoTarget(
  node: InfrastructureNode | undefined,
  criticality: DRPService['criticality'],
): string {
  const explicit = readNumber(node?.validatedRPO) ?? readNumber(node?.suggestedRPO);
  if (explicit !== null) return `${Math.max(1, Math.round(explicit))}m`;
  return { critical: '5m', high: '15m', medium: '1h', low: '24h' }[criticality];
}

function inferProvider(nodes: readonly InfrastructureNode[]): string {
  return nodes[0]?.provider ?? 'unknown';
}

function collectRegions(nodes: readonly InfrastructureNode[]): readonly string[] {
  return Array.from(
    new Set(nodes.map((node) => node.region).filter((region): region is string => Boolean(region))),
  ).sort();
}

function aggregateMaxDuration(durations: readonly string[]): string {
  const max = durations.reduce((current, value) => Math.max(current, parseDrpDuration(value)), 0);
  return formatDurationValue(max);
}

function aggregateMaxRpo(rpos: readonly string[]): string {
  if (rpos.some((value) => value === 'total_loss')) return 'total_loss';
  return aggregateMaxDuration(rpos);
}

function aggregateAverageRpo(rpos: readonly string[]): string {
  if (rpos.length === 0) return '0s';
  if (rpos.some((value) => value === 'total_loss')) return 'total_loss';

  const total = rpos.reduce((sum, value) => sum + parseDrpDuration(value), 0);
  return formatDurationValue(Math.round(total / rpos.length));
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeValue(item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeValue(item)]),
    );
  }
  return value;
}

function compareByCriticality(left: InfrastructureNode, right: InfrastructureNode): number {
  const leftScore = readNumber(left.criticalityScore) ?? 0;
  const rightScore = readNumber(right.criticalityScore) ?? 0;
  return (
    rightScore - leftScore || left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  );
}

function compareRecoveryPriority(graph: GraphInstance, leftId: string, rightId: string): number {
  const left = graph.getNodeAttributes(leftId) as unknown as InfrastructureNode;
  const right = graph.getNodeAttributes(rightId) as unknown as InfrastructureNode;
  return compareByCriticality(left, right);
}

function formatDurationValue(seconds: number): string {
  if (seconds === Number.POSITIVE_INFINITY) return 'total_loss';
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds % 3600 === 0) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 60)}m`;
}
