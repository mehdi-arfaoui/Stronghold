import '@xyflow/react/dist/style.css';
import type {
  DRPComponent,
  InfraNode,
  ValidationReport,
  ValidationStatus,
} from '@stronghold-dr/core';
import type { Edge, Node } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { generatePlan } from '@/api/plans';
import { getLatestScan, getScanData } from '@/api/scans';
import { EmptyState } from '@/components/common/EmptyState';
import { ErrorState } from '@/components/common/ErrorState';
import { InfraDisclaimer } from '@/components/common/InfraDisclaimer';
import { CardSkeleton } from '@/components/common/Skeleton';
import { GraphControls } from '@/components/graph/GraphControls';
import { InfraGraph } from '@/components/graph/InfraGraph';
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
    },
  };
}

export default function GraphPage(): JSX.Element {
  const { scanId } = useParams();
  const navigate = useNavigate();
  const setCurrentScanId = useAppStore((state) => state.setCurrentScanId);

  const [selectedTypes, setSelectedTypes] = useState<ReadonlySet<string>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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

  const rawNodes = useMemo(
    () => data?.scanData.nodes ?? [],
    [data?.scanData.nodes],
  );
  const rawEdges = useMemo(
    () => data?.scanData.edges ?? [],
    [data?.scanData.edges],
  );
  const validationReport = data?.scanData.validationReport ?? null;

  const availableTypes = useMemo(
    () => Array.from(new Set(rawNodes.map((node) => node.type))).sort((left, right) => left.localeCompare(right)),
    [rawNodes],
  );

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

  const filteredNodes = useMemo(
    () =>
      selectedTypes.size === 0
        ? rawNodes
        : rawNodes.filter((node) => selectedTypes.has(node.type)),
    [rawNodes, selectedTypes],
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
        ),
      );
    });

    const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
    const edgeWeights = new Map<string, { readonly source: string; readonly target: string; readonly type: string; count: number }>();

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
      const current = edgeWeights.get(key);
      if (current) {
        current.count += 1;
        return;
      }

      edgeWeights.set(key, {
        source,
        target,
        type: edge.type,
        count: 1,
      });
    });

    const displayEdges: Array<Edge> = Array.from(edgeWeights.entries()).map(([key, value]) => ({
      id: key,
      source: value.source,
      target: value.target,
      label: value.count > 1 ? `${value.type} ×${value.count}` : value.type,
    }));

    return {
      nodes: displayNodes,
      edges: displayEdges,
      memberGroupMap,
      nodeToDisplayMap: nodeToDisplay,
    };
  }, [componentById, expandAll, expandedGroups, filteredNodes, rawEdges, selectedTypes.size, statusMap]);

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
      <div className="grid gap-4 xl:grid-cols-4">
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
