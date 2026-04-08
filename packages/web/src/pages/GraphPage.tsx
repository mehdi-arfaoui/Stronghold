import '@xyflow/react/dist/style.css';
import type {
  DRPComponent,
  InfraNode,
  ValidationReport,
  ValidationStatus,
} from '@stronghold-dr/core';
import type { Edge, Node } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { generatePlan } from '@/api/plans';
import { getLatestScan, getScanData } from '@/api/scans';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { InfraDisclaimer } from '@/components/common/InfraDisclaimer';
import { CardSkeleton } from '@/components/common/Skeleton';
import { GraphControls } from '@/components/graph/GraphControls';
import { InfraGraph, type GraphEdgeVisualData } from '@/components/graph/InfraGraph';
import { GraphSearch } from '@/components/graph/GraphSearch';
import { type GraphVisualData } from '@/components/graph/GraphNode';
import { NodeDetails } from '@/components/graph/NodeDetails';
import { useAsync } from '@/hooks/use-async';
import { useAppStore } from '@/store/app-store';

const STATUS_PRIORITY: Record<ValidationStatus, number> = {
  fail: 0,
  error: 1,
  warn: 2,
  pass: 3,
  skip: 4,
};

const EDGE_PROVENANCE_PRIORITY: Record<'manual' | 'inferred' | 'aws-api', number> = {
  manual: 0,
  inferred: 1,
  'aws-api': 2,
};

const SERVICE_COLORS = ['#ef4444', '#0f766e', '#2563eb', '#ca8a04', '#c2410c', '#0891b2', '#4f46e5', '#be123c'];

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function primaryNodeLabel(node: InfraNode): string {
  return node.displayName ?? node.businessName ?? node.name;
}

function buildStatusMap(report: ValidationReport): Map<string, ValidationStatus> {
  const statusMap = new Map<string, ValidationStatus>();

  for (const result of report.results) {
    const current = statusMap.get(result.nodeId);
    if (!current || STATUS_PRIORITY[result.status] < STATUS_PRIORITY[current]) {
      statusMap.set(result.nodeId, result.status);
    }
  }

  return statusMap;
}

function worstStatus(statuses: readonly ValidationStatus[]): ValidationStatus {
  return statuses.reduce<ValidationStatus>((currentWorst, currentStatus) => {
    return STATUS_PRIORITY[currentStatus] < STATUS_PRIORITY[currentWorst] ? currentStatus : currentWorst;
  }, 'skip');
}

function describeGroup(node: InfraNode, hasActiveFilters: boolean): {
  readonly key: string;
  readonly label: string;
  readonly noun: string;
} | null {
  const metadata = node.metadata as Record<string, unknown>;
  const region = node.region ?? 'global';
  const asg =
    readText(metadata.autoScalingGroupName) ??
    readText(metadata.asgName) ??
    readText(node.tags['aws:autoscaling:groupName']);
  if (asg) {
    return { key: `asg:${asg}:${region}`, label: `ASG: ${asg}`, noun: 'instances' };
  }

  const vpcId = readText(metadata.vpcId);
  if (node.type.toLowerCase().includes('subnet') && vpcId) {
    return { key: `vpc:${vpcId}:${region}:subnets`, label: `VPC: ${vpcId}`, noun: 'subnets' };
  }

  const typeLower = node.type.toLowerCase();
  if (!hasActiveFilters && (typeLower.includes('lambda') || typeLower.includes('serverless'))) {
    return { key: `lambda:${region}`, label: 'Lambda', noun: 'functions' };
  }

  if (hasActiveFilters) {
    return null;
  }

  const context =
    readText(metadata.clusterName) ??
    readText(metadata.vpcId) ??
    readText(metadata.subnetId) ??
    node.region ??
    'global';
  return { key: `type:${node.type}:${context}`, label: `${node.type}: ${context}`, noun: 'resources' };
}

function buildIndividualNode(
  node: InfraNode,
  status: ValidationStatus,
  component: DRPComponent | null,
  serviceLabel?: string,
  accentColor?: string,
  muted = false,
  scenarioState?: GraphVisualData['scenarioState'],
): Node<GraphVisualData> {
  return {
    id: node.id,
    type: 'graphNode',
    position: { x: 0, y: 0 },
    data: {
      label: primaryNodeLabel(node),
      subtitle: `${node.type}${node.region ? ` · ${node.region}` : ''}`,
      nodeType: node.type,
      status,
      emphasis: component ? `RTO ${component.estimatedRTO}` : undefined,
      serviceLabel,
      accentColor,
      muted,
      scenarioState,
    },
  };
}

function normalizeEdgeProvenance(value: unknown): 'manual' | 'inferred' | 'aws-api' {
  return value === 'manual' || value === 'inferred' || value === 'aws-api' ? value : 'aws-api';
}

function isScenarioApplicationEdge(type: string): boolean {
  return [
    'depends_on',
    'triggers',
    'publishes_to',
    'subscribes_to',
    'connects_to',
    'routes_to',
  ].includes(type);
}

function resolveScenarioState(
  nodeIds: readonly string[],
  directIds: ReadonlySet<string>,
  cascadeIds: ReadonlySet<string>,
  scenarioMode: boolean,
): GraphVisualData['scenarioState'] {
  if (!scenarioMode) {
    return undefined;
  }
  if (nodeIds.some((nodeId) => directIds.has(nodeId))) {
    return 'direct';
  }
  if (nodeIds.some((nodeId) => cascadeIds.has(nodeId))) {
    return 'cascade';
  }
  return 'unaffected';
}

export default function GraphPage(): JSX.Element {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setCurrentScanId = useAppStore((state) => state.setCurrentScanId);

  const [selectedTypes, setSelectedTypes] = useState<ReadonlySet<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedServiceFilter, setSelectedServiceFilter] = useState<string | null>(
    searchParams.get('service'),
  );
  const [scenarioMode, setScenarioMode] = useState(searchParams.get('scenario') != null);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(
    searchParams.get('scenario'),
  );
  const [focusRequest, setFocusRequest] = useState<{ readonly id: string; readonly nonce: number } | null>(null);
  const [command, setCommand] = useState<{ readonly type: 'zoom-in' | 'zoom-out' | 'fit'; readonly nonce: number } | null>(null);

  const fetchGraph = useCallback(async () => {
    const latest = scanId ? null : await getLatestScan();
    const resolvedScanId = scanId ?? latest?.id ?? null;
    if (!resolvedScanId) {
      return null;
    }

    const [scanData, planResult] = await Promise.all([
      getScanData(resolvedScanId),
      generatePlan(resolvedScanId),
    ]);

    return {
      resolvedScanId,
      scanData,
      plan: planResult.plan,
    };
  }, [scanId]);

  const { data, error, isLoading, retry } = useAsync(fetchGraph);

  useEffect(() => {
    setCurrentScanId(data?.resolvedScanId ?? null);
  }, [data?.resolvedScanId, setCurrentScanId]);

  useEffect(() => {
    setSelectedServiceFilter(searchParams.get('service'));
  }, [searchParams]);

  useEffect(() => {
    const scenario = searchParams.get('scenario');
    setScenarioMode(scenario != null);
    setSelectedScenarioId(scenario);
  }, [searchParams]);

  const rawNodes = useMemo(
    () => data?.scanData.nodes ?? [],
    [data?.scanData.nodes],
  );
  const rawEdges = useMemo(
    () => data?.scanData.edges ?? [],
    [data?.scanData.edges],
  );
  const validationReport = data?.scanData.validationReport ?? null;
  const serviceAssignments = useMemo(() => {
    const assignments = new Map<string, { readonly id: string; readonly name: string }>();
    (data?.scanData.servicePosture?.services ?? []).forEach((service) => {
      service.service.resources.forEach((resource) => {
        assignments.set(resource.nodeId, {
          id: service.service.id,
          name: service.service.name,
        });
      });
    });
    return assignments;
  }, [data?.scanData.servicePosture?.services]);

  const availableTypes = useMemo(
    () => Array.from(new Set(rawNodes.map((node) => node.type))).sort((left, right) => left.localeCompare(right)),
    [rawNodes],
  );
  const availableServices = useMemo(
    () =>
      (data?.scanData.servicePosture?.services ?? [])
        .map((service) => ({
          id: service.service.id,
          name: service.service.name,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    [data?.scanData.servicePosture?.services],
  );
  const availableScenarios = useMemo(
    () => data?.scanData.scenarioAnalysis?.scenarios ?? [],
    [data?.scanData.scenarioAnalysis?.scenarios],
  );

  useEffect(() => {
    if (!scenarioMode) {
      return;
    }

    if (availableScenarios.length === 0) {
      setSelectedScenarioId(null);
      return;
    }

    if (!selectedScenarioId || !availableScenarios.some((scenario) => scenario.id === selectedScenarioId)) {
      setSelectedScenarioId(availableScenarios[0]?.id ?? null);
    }
  }, [availableScenarios, scenarioMode, selectedScenarioId]);

  const allNodeMap = useMemo(
    () => new Map(rawNodes.map((node) => [node.id, node])),
    [rawNodes],
  );

  const componentById = useMemo(() => {
    const entries = data?.plan?.services.flatMap((service) => service.components) ?? [];
    return new Map(entries.map((component) => [component.resourceId, component]));
  }, [data?.plan?.services]);

  const statusMap = useMemo(
    () => (validationReport ? buildStatusMap(validationReport) : new Map<string, ValidationStatus>()),
    [validationReport],
  );
  const selectedScenario = useMemo(
    () =>
      availableScenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null,
    [availableScenarios, selectedScenarioId],
  );
  const directScenarioIds = useMemo(
    () => new Set(selectedScenario?.impact?.directlyAffected.map((node) => node.nodeId) ?? []),
    [selectedScenario],
  );
  const cascadeScenarioIds = useMemo(
    () => new Set(selectedScenario?.impact?.cascadeAffected.map((node) => node.nodeId) ?? []),
    [selectedScenario],
  );
  const affectedScenarioIds = useMemo(
    () => new Set([...directScenarioIds, ...cascadeScenarioIds]),
    [cascadeScenarioIds, directScenarioIds],
  );

  const filteredNodes = useMemo(
    () =>
      selectedTypes.size === 0
        ? rawNodes
        : rawNodes.filter((node) => selectedTypes.has(node.type)),
    [rawNodes, selectedTypes],
  );
  const serviceColorById = useMemo(
    () =>
      new Map(
        availableServices.map((service) => [
          service.id,
          SERVICE_COLORS[Math.abs(hashValue(service.id)) % SERVICE_COLORS.length] ?? '#64748b',
        ] as const),
      ),
    [availableServices],
  );

  const graphData = useMemo(() => {
    const hasActiveFilters = selectedTypes.size > 0;
    const groupByNode = new Map<string, { readonly groupId: string; readonly label: string; readonly noun: string }>();
    const groupMembers = new Map<string, InfraNode[]>();

    if (!expandAll) {
      filteredNodes.forEach((node) => {
        const descriptor = describeGroup(node, hasActiveFilters);
        if (!descriptor) {
          return;
        }

        const groupId = `group:${descriptor.key}`;
        groupByNode.set(node.id, { groupId, label: descriptor.label, noun: descriptor.noun });
        const current = groupMembers.get(groupId) ?? [];
        current.push(node);
        groupMembers.set(groupId, current);
      });
    }

    const memberGroupMap = new Map<string, string>();
    const nodeToDisplay = new Map<string, string>();
    const displayNodes: Array<Node<GraphVisualData>> = [];
    const createdGroups = new Set<string>();

    filteredNodes.forEach((node) => {
      const groupInfo = groupByNode.get(node.id);
      if (groupInfo) {
        const members = groupMembers.get(groupInfo.groupId) ?? [];
        const shouldCollapse = members.length > 1 && !expandedGroups.has(groupInfo.groupId);
        if (shouldCollapse) {
          memberGroupMap.set(node.id, groupInfo.groupId);
          nodeToDisplay.set(node.id, groupInfo.groupId);
          if (!createdGroups.has(groupInfo.groupId)) {
            createdGroups.add(groupInfo.groupId);
            const groupStatus = worstStatus(
              members.map((member) => statusMap.get(member.id) ?? 'skip'),
            );
            displayNodes.push({
              id: groupInfo.groupId,
              type: 'groupedNode',
              position: { x: 0, y: 0 },
              data: {
                label: `${groupInfo.label} (${members.length} ${groupInfo.noun})`,
                subtitle: members.slice(0, 3).map((member) => primaryNodeLabel(member)).join(', '),
                nodeType: members[0]?.type ?? 'GROUP',
                status: groupStatus,
                ...resolveServiceVisual(
                  members.map((member) => member.id),
                  serviceAssignments,
                  serviceColorById,
                  selectedServiceFilter,
                ),
                scenarioState: resolveScenarioState(
                  members.map((member) => member.id),
                  directScenarioIds,
                  cascadeScenarioIds,
                  scenarioMode,
                ),
              },
            });
          }
          return;
        }
      }

      nodeToDisplay.set(node.id, node.id);
      displayNodes.push(
        buildIndividualNode(
          node,
          statusMap.get(node.id) ?? 'skip',
          componentById.get(node.id) ?? null,
          serviceAssignments.get(node.id)?.name,
          serviceAssignments.get(node.id)
            ? serviceColorById.get(serviceAssignments.get(node.id)?.id ?? '')
            : '#6b7280',
          (selectedServiceFilter !== null &&
            serviceAssignments.get(node.id)?.id !== selectedServiceFilter) ||
            (scenarioMode && !affectedScenarioIds.has(node.id)),
          resolveScenarioState([node.id], directScenarioIds, cascadeScenarioIds, scenarioMode),
        ),
      );
    });

    const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
    const edgeWeights = new Map<
      string,
      {
        readonly source: string;
        readonly target: string;
        readonly type: string;
        provenance: 'manual' | 'inferred' | 'aws-api';
        count: number;
        highlighted: boolean;
      }
    >();

    rawEdges.forEach((edge) => {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) {
        return;
      }

      const source = nodeToDisplay.get(edge.source);
      const target = nodeToDisplay.get(edge.target);
      if (!source || !target || source === target) {
        return;
      }

      const key = `${source}:${target}:${edge.type}`;
      const highlighted =
        scenarioMode &&
        affectedScenarioIds.has(edge.source) &&
        affectedScenarioIds.has(edge.target) &&
        isScenarioApplicationEdge(edge.type);
      const current = edgeWeights.get(key);
      if (current) {
        current.count += 1;
        current.highlighted = current.highlighted || highlighted;
        const provenance = normalizeEdgeProvenance(edge.provenance);
        if (EDGE_PROVENANCE_PRIORITY[provenance] < EDGE_PROVENANCE_PRIORITY[current.provenance]) {
          current.provenance = provenance;
        }
        return;
      }

      edgeWeights.set(key, {
        source,
        target,
        type: edge.type,
        provenance: normalizeEdgeProvenance(edge.provenance),
        count: 1,
        highlighted,
      });
    });

    const displayEdges: Array<Edge<GraphEdgeVisualData>> = Array.from(edgeWeights.entries()).map(
      ([key, value]) => ({
        id: key,
        source: value.source,
        target: value.target,
        label: value.count > 1 ? `${value.type} x${value.count}` : value.type,
        data: {
          provenance: value.provenance,
          highlighted: value.highlighted,
          dimmed: scenarioMode && !value.highlighted,
        },
      }),
    );

    return {
      nodes: displayNodes,
      edges: displayEdges,
      memberGroupMap,
      nodeToDisplayMap: nodeToDisplay,
    };
  }, [affectedScenarioIds, cascadeScenarioIds, componentById, directScenarioIds, expandAll, expandedGroups, filteredNodes, rawEdges, scenarioMode, selectedServiceFilter, selectedTypes.size, serviceAssignments, serviceColorById, statusMap]);

  const searchOptions = useMemo(
    () =>
      filteredNodes.map((node) => ({
        id: node.id,
        label: primaryNodeLabel(node),
        subtitle: `${node.type}${node.region ? ` · ${node.region}` : ''}`,
      })),
    [filteredNodes],
  );

  const selectedNode = selectedNodeId ? allNodeMap.get(selectedNodeId) ?? null : null;
  const selectedDisplayNodeId =
    selectedNodeId ? graphData.nodeToDisplayMap.get(selectedNodeId) ?? selectedNodeId : null;

  const selectedNodeResults = useMemo(() => {
    if (!selectedNodeId || !validationReport) {
      return [];
    }

    return validationReport.results
      .filter((result) => result.nodeId === selectedNodeId)
      .slice()
      .sort((left, right) => right.weight - left.weight);
  }, [selectedNodeId, validationReport]);

  const incomingDependencies = useMemo(() => {
    if (!selectedNodeId) {
      return [];
    }

    return rawEdges
      .filter((edge) => edge.target === selectedNodeId)
      .map((edge) => allNodeMap.get(edge.source))
      .filter((node): node is InfraNode => node != null);
  }, [allNodeMap, rawEdges, selectedNodeId]);

  const outgoingDependencies = useMemo(() => {
    if (!selectedNodeId) {
      return [];
    }

    return rawEdges
      .filter((edge) => edge.source === selectedNodeId)
      .map((edge) => allNodeMap.get(edge.target))
      .filter((node): node is InfraNode => node != null);
  }, [allNodeMap, rawEdges, selectedNodeId]);

  const toggleType = (type: string): void => {
    setSelectedTypes((current) => {
      const next = current.size === 0 ? new Set(availableTypes) : new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next.size === 0 || next.size === availableTypes.length ? new Set<string>() : next;
    });
  };

  const handleSearchSelect = (nodeId: string): void => {
    const groupId = graphData.memberGroupMap.get(nodeId);
    if (groupId && !expandAll) {
      setExpandedGroups((current) => new Set([...current, groupId]));
    }
    setSelectedNodeId(nodeId);
    setFocusRequest({ id: nodeId, nonce: Date.now() });
  };

  const issueCommand = (type: 'zoom-in' | 'zoom-out' | 'fit'): void => {
    setCommand({ type, nonce: Date.now() });
  };

  const selectedRtoComponent = selectedNodeId ? componentById.get(selectedNodeId) ?? null : null;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={retry} />;
  }

  if (!data) {
    return (
      <EmptyState
        title="No graph"
        description="Run a completed scan to build the dependency graph."
      />
    );
  }

  if (rawNodes.length === 0) {
    return (
      <EmptyState
        title="No graph data"
        description="The selected scan does not contain any infrastructure nodes."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 xl:grid-cols-5">
        <section className="panel p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Visible nodes</p>
          <div className="mt-2 text-3xl font-semibold text-foreground">{graphData.nodes.length}</div>
        </section>
        <section className="panel p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Dependencies</p>
          <div className="mt-2 text-3xl font-semibold text-foreground">{graphData.edges.length}</div>
        </section>
        <section className="panel p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Resources</p>
          <div className="mt-2 text-3xl font-semibold text-foreground">{rawNodes.length}</div>
        </section>
        <section className="panel p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Services</p>
          <div className="mt-2 text-3xl font-semibold text-foreground">{availableServices.length}</div>
        </section>
        <section className="panel p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Report score</p>
          <div className="mt-2 text-3xl font-semibold text-foreground">
            {Math.round(validationReport?.scoreBreakdown.overall ?? 0)}
          </div>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <GraphSearch nodes={searchOptions} onSelect={handleSearchSelect} />
          <GraphControls
            availableTypes={availableTypes}
            selectedTypes={selectedTypes}
            onToggleType={toggleType}
            onClearTypes={() => setSelectedTypes(new Set())}
            expandAll={expandAll}
            onToggleExpandAll={() => {
              setExpandAll((current) => !current);
              setExpandedGroups(new Set());
            }}
            onZoomIn={() => issueCommand('zoom-in')}
            onZoomOut={() => issueCommand('zoom-out')}
            onFitView={() => issueCommand('fit')}
          />
          <section className="panel p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Service highlight</p>
            <select
              value={selectedServiceFilter ?? ''}
              onChange={(event) => setSelectedServiceFilter(event.target.value || null)}
              className="input-field mt-3 w-full"
            >
              <option value="">All services</option>
              {availableServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </section>
          <section className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Scenario mode</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Highlight direct and cascading disruption impact on the graph.
                </p>
              </div>
              <label className="inline-flex items-center gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  style={{ accentColor: 'hsl(var(--accent))' }}
                  checked={scenarioMode}
                  onChange={(event) => setScenarioMode(event.target.checked)}
                />
                Enabled
              </label>
            </div>
            {scenarioMode ? (
              <div className="mt-4 space-y-3">
                {availableScenarios.length > 0 ? (
                  <select
                    value={selectedScenarioId ?? ''}
                    onChange={(event) => setSelectedScenarioId(event.target.value || null)}
                    className="input-field w-full"
                  >
                    {availableScenarios.map((scenario) => (
                      <option key={scenario.id} value={scenario.id}>
                        {scenario.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                    Scenario analysis is not available for the selected scan yet.
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-border bg-elevated p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Direct</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{selectedScenario?.impact?.directlyAffected.length ?? 0}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-elevated p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Cascade</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{selectedScenario?.impact?.cascadeAffected.length ?? 0}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-elevated p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-subtle-foreground">Coverage</p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {selectedScenario?.coverage?.verdict?.replace('_', ' ') ?? 'unknown'}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
          <section className="panel p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-subtle-foreground">Edge legend</p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-foreground">
              <div className="flex items-center gap-2">
                <span className="w-9 border-t-2 border-foreground/70" />
                <span>AWS API</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-9 border-t-2 border-dashed border-muted-foreground" />
                <span>Inferred</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className="w-9 border-t-2 border-dashed"
                  style={{ borderColor: '#c26d1f' }}
                />
                <span>Manual override</span>
              </div>
              {scenarioMode ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-9 border-t-2 border-amber-400" />
                    <span>Scenario impact path</span>
                  </div>
                </>
              ) : null}
            </div>
          </section>
          <InfraGraph
            nodes={graphData.nodes}
            edges={graphData.edges}
            selectedNodeId={selectedDisplayNodeId}
            focusRequest={focusRequest}
            command={command}
            onNodeSelect={(nodeId) => {
              setSelectedNodeId(nodeId);
              setFocusRequest({ id: nodeId, nonce: Date.now() });
            }}
            onGroupToggle={(groupId) => {
              setExpandedGroups((current) => {
                const next = new Set(current);
                if (next.has(groupId)) {
                  next.delete(groupId);
                } else {
                  next.add(groupId);
                }
                return next;
              });
            }}
          />
          <InfraDisclaimer />
        </div>
        <NodeDetails
          node={selectedNode}
          incoming={incomingDependencies}
          outgoing={outgoingDependencies}
          results={selectedNodeResults}
          rtoComponent={selectedRtoComponent}
          onViewInReport={() => {
            if (!selectedNode) {
              return;
            }
            navigate(`/report/${data.resolvedScanId}?node=${selectedNode.id}`);
          }}
        />
      </div>
    </div>
  );
}

function resolveServiceVisual(
  nodeIds: readonly string[],
  serviceAssignments: ReadonlyMap<string, { readonly id: string; readonly name: string }>,
  serviceColorById: ReadonlyMap<string, string>,
  selectedServiceFilter: string | null,
): {
  readonly serviceLabel?: string;
  readonly accentColor?: string;
  readonly muted?: boolean;
} {
  const assigned = nodeIds
    .map((nodeId) => serviceAssignments.get(nodeId))
    .filter((service): service is { readonly id: string; readonly name: string } => service != null);
  if (assigned.length === 0) {
    return {
      serviceLabel: 'Unassigned',
      accentColor: '#6b7280',
      muted: selectedServiceFilter !== null,
    };
  }

  const distinctIds = new Set(assigned.map((service) => service.id));
  const primary = assigned[0];
  if (!primary) {
    return {};
  }

  return {
    serviceLabel: distinctIds.size === 1 ? primary.name : `${distinctIds.size} services`,
    accentColor: serviceColorById.get(primary.id) ?? '#64748b',
    muted: selectedServiceFilter !== null && !distinctIds.has(selectedServiceFilter),
  };
}

function hashValue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
}
