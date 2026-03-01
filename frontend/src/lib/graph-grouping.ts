import type { Edge, Node } from '@xyflow/react';

export type GroupKind = 'region' | 'vpc' | 'subnet';

export interface GroupZoneData {
  label: string;
  groupType: GroupKind;
  memberIds: string[];
}

interface GroupPart {
  id: string;
  key: string;
  label: string;
  kind: GroupKind;
  depth: number;
  parentId?: string;
}

const GROUP_STYLE_PRESETS: Record<GroupKind, { padding: number; topPadding: number; backgroundColor: string; border: string; borderRadius: number }> = {
  region: {
    padding: 36,
    topPadding: 34,
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    border: '2px dashed rgba(59, 130, 246, 0.28)',
    borderRadius: 22,
  },
  vpc: {
    padding: 24,
    topPadding: 28,
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    border: '2px solid rgba(16, 185, 129, 0.28)',
    borderRadius: 18,
  },
  subnet: {
    padding: 18,
    topPadding: 24,
    backgroundColor: 'rgba(245, 158, 11, 0.05)',
    border: '1px dashed rgba(245, 158, 11, 0.32)',
    borderRadius: 16,
  },
};

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function toCleanString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function compactId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function nodeDimensions(node: Node, fallbackWidth = 180, fallbackHeight = 60) {
  const style = (node.style as Record<string, unknown> | undefined) || {};
  return {
    width: Math.max(60, toNumber(style.width) ?? toNumber(node.width) ?? fallbackWidth),
    height: Math.max(40, toNumber(style.height) ?? toNumber(node.height) ?? fallbackHeight),
  };
}

function buildLabel(kind: GroupKind, key: string, metadata?: Record<string, unknown>, fallback?: string | null) {
  const cidr = toCleanString(metadata?.cidrBlock ?? metadata?.cidr);
  const base =
    fallback ||
    (kind === 'region'
      ? key
      : kind === 'vpc'
        ? `VPC ${compactId(key)}`
        : `Subnet ${compactId(key)}`);
  return cidr ? `${base} (${cidr})` : base;
}

export function extractGroupPath(node: Node): GroupPart[] {
  const data = toRecord(node.data) || {};
  const metadata = toRecord(data.metadata) || {};
  const nodeType = toCleanString(data.nodeType) ?? toCleanString(node.type) ?? '';
  const label = toCleanString(data.label) ?? node.id;
  const parts: GroupPart[] = [];

  const regionKey = toCleanString(data.region ?? metadata.region) || (nodeType === 'REGION' ? label : null);
  if (regionKey) {
    parts.push({
      id: `group:region:${regionKey}`,
      key: regionKey,
      label: buildLabel('region', regionKey, metadata, regionKey),
      kind: 'region',
      depth: 0,
    });
  }

  const vpcKey =
    toCleanString(metadata.vpcId ?? metadata.vnetId ?? metadata.networkId) ||
    (nodeType === 'VPC' ? node.id : null);
  if (vpcKey) {
    parts.push({
      id: `group:vpc:${vpcKey}`,
      key: vpcKey,
      label: buildLabel('vpc', vpcKey, metadata, nodeType === 'VPC' ? label : null),
      kind: 'vpc',
      depth: 1,
      parentId: parts[parts.length - 1]?.id,
    });
  }

  const subnetKey = toCleanString(metadata.subnetId) || (nodeType === 'SUBNET' ? node.id : null);
  if (subnetKey) {
    parts.push({
      id: `group:subnet:${subnetKey}`,
      key: subnetKey,
      label: buildLabel('subnet', subnetKey, metadata, nodeType === 'SUBNET' ? label : null),
      kind: 'subnet',
      depth: 2,
      parentId: parts[parts.length - 1]?.id,
    });
  }

  return parts;
}

export function augmentEdgesForGrouping(nodes: Node[], edges: Edge[]): Edge[] {
  const byGroup = new Map<string, Node[]>();
  const edgeKeys = new Set(edges.flatMap((edge) => [`${edge.source}->${edge.target}`, `${edge.target}->${edge.source}`]));

  nodes.forEach((node) => {
    if (node.type !== 'infraNode') return;
    const deepest = extractGroupPath(node).at(-1);
    if (!deepest) return;
    const current = byGroup.get(deepest.id) || [];
    current.push(node);
    byGroup.set(deepest.id, current);
  });

  const synthetic: Edge[] = [];
  for (const [groupId, members] of byGroup.entries()) {
    if (members.length < 2) continue;
    const ordered = [...members].sort((left, right) => String((left.data as Record<string, unknown> | undefined)?.label ?? left.id).localeCompare(String((right.data as Record<string, unknown> | undefined)?.label ?? right.id)));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const key = `${previous.id}->${current.id}`;
      if (edgeKeys.has(key)) continue;
      synthetic.push({
        id: `layout-affinity:${groupId}:${previous.id}:${current.id}`,
        source: previous.id,
        target: current.id,
        hidden: true,
      });
      edgeKeys.add(key);
    }
  }

  return synthetic.length > 0 ? [...edges, ...synthetic] : edges;
}

export function applyHierarchicalGrouping(nodes: Node[]): Node[] {
  const leafNodes: Node[] = nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    parentId: undefined,
    extent: undefined,
  }) as Node);
  const pathsByNode = new Map<string, GroupPart[]>();
  const groups = new Map<string, GroupPart & { memberIds: Set<string>; childGroupIds: Set<string> }>();

  leafNodes.forEach((node) => {
    if (node.type !== 'infraNode') return;
    const path = extractGroupPath(node);
    if (path.length === 0) return;
    pathsByNode.set(node.id, path);
    path.forEach((part, index) => {
      const existing = groups.get(part.id) || { ...part, memberIds: new Set<string>(), childGroupIds: new Set<string>() };
      existing.memberIds.add(node.id);
      if (index > 0) {
        const parentId = path[index - 1]?.id;
        if (parentId) {
          existing.parentId = parentId;
          groups.get(parentId)?.childGroupIds.add(part.id);
        }
      }
      groups.set(part.id, existing);
      if (index > 0) {
        groups.get(path[index - 1].id)?.childGroupIds.add(part.id);
      }
    });
  });

  const activeGroupIds = new Set(
    Array.from(groups.values())
      .filter((group) => group.memberIds.size > 1 || group.childGroupIds.size > 0)
      .map((group) => group.id),
  );
  if (activeGroupIds.size === 0) return leafNodes;

  const absoluteGroupBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
  Array.from(groups.values())
    .filter((group) => activeGroupIds.has(group.id))
    .forEach((group) => {
      const members = Array.from(group.memberIds)
        .map((id) => leafNodes.find((node) => node.id === id))
        .filter((node): node is Node => node !== undefined);
      if (members.length === 0) return;

      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      members.forEach((member) => {
        const size = nodeDimensions(member);
        minX = Math.min(minX, member.position.x);
        minY = Math.min(minY, member.position.y);
        maxX = Math.max(maxX, member.position.x + size.width);
        maxY = Math.max(maxY, member.position.y + size.height);
      });

      const preset = GROUP_STYLE_PRESETS[group.kind];
      absoluteGroupBounds.set(group.id, {
        x: minX - preset.padding,
        y: minY - preset.topPadding,
        width: maxX - minX + preset.padding * 2,
        height: maxY - minY + preset.padding + preset.topPadding,
      });
    });

  const groupNodes = Array.from(groups.values())
    .filter((group) => activeGroupIds.has(group.id) && absoluteGroupBounds.has(group.id))
    .sort((left, right) => left.depth - right.depth)
    .map((group) => {
      const bounds = absoluteGroupBounds.get(group.id)!;
      const preset = GROUP_STYLE_PRESETS[group.kind];
      const parentBounds = group.parentId ? absoluteGroupBounds.get(group.parentId) : undefined;
      return {
        id: group.id,
        type: 'groupZone',
        position: parentBounds ? { x: bounds.x - parentBounds.x, y: bounds.y - parentBounds.y } : { x: bounds.x, y: bounds.y },
        parentId: group.parentId && activeGroupIds.has(group.parentId) ? group.parentId : undefined,
        selectable: false,
        draggable: false,
        connectable: false,
        focusable: false,
        data: {
          label: group.label,
          groupType: group.kind,
          memberIds: Array.from(group.memberIds),
        } satisfies GroupZoneData,
        style: {
          width: bounds.width,
          height: bounds.height,
          pointerEvents: 'none',
          zIndex: 0,
          backgroundColor: preset.backgroundColor,
          border: preset.border,
          borderRadius: preset.borderRadius,
        },
      } satisfies Node;
    });

  leafNodes.forEach((node) => {
    const path = pathsByNode.get(node.id);
    const parent = path ? [...path].reverse().find((part) => activeGroupIds.has(part.id)) : undefined;
    if (!parent) return;
    const parentBounds = absoluteGroupBounds.get(parent.id);
    if (!parentBounds) return;
    node.parentId = parent.id;
    node.extent = 'parent';
    node.position = {
      x: node.position.x - parentBounds.x,
      y: node.position.y - parentBounds.y,
    };
    node.zIndex = 10;
  });

  return [...groupNodes, ...leafNodes];
}
