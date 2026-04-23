import type { Service } from '../services/index.js';
import type { WeightedValidationResult } from '../validation/index.js';
import type {
  RenderGraphOptions,
  RenderedGraphEdge,
  RenderedGraphNode,
} from './graph-html-renderer-types.js';

const WIDTH = 1200;
const HEIGHT = 780;
const CENTER_X = WIDTH / 2;
const CENTER_Y = 360;
const RADIUS = 280;

const SEVERITY_RANK: Record<WeightedValidationResult['severity'], number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function renderGraphAsHtml(options: RenderGraphOptions): string {
  const title = options.title ?? 'Stronghold Graph';
  const nodes = serializeNodes(options);
  const edges = serializeEdges(options);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --ink: #17202a;
      --muted: #5e6a78;
      --panel: #ffffff;
      --line: #8291a5;
      --cross: #b42318;
      --ok: #24745c;
      --critical: #b42318;
      --high: #d15b17;
      --medium: #9f7a05;
      --low: #24745c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--ink);
    }
    header {
      padding: 20px 24px 10px;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 16px;
      border-bottom: 1px solid #d9dee8;
      background: var(--panel);
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    main {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 260px;
      gap: 0;
      min-height: calc(100vh - 108px);
    }
    .canvas {
      min-width: 0;
      overflow: auto;
      padding: 16px;
    }
    svg {
      display: block;
      width: 100%;
      min-width: 860px;
      height: auto;
      background: #ffffff;
      border: 1px solid #d9dee8;
      border-radius: 8px;
    }
    aside {
      border-left: 1px solid #d9dee8;
      background: var(--panel);
      padding: 18px;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 14px;
      letter-spacing: 0;
    }
    .legend {
      display: grid;
      gap: 10px;
      font-size: 13px;
      color: var(--muted);
    }
    .legend-row {
      display: grid;
      grid-template-columns: 18px 1fr;
      align-items: center;
      gap: 8px;
    }
    .swatch {
      width: 18px;
      height: 4px;
      border-radius: 2px;
      background: var(--line);
    }
    .swatch.cross {
      border-top: 2px dashed var(--cross);
      background: transparent;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--ok);
      border: 2px solid #ffffff;
      box-shadow: 0 0 0 1px #c2cad6;
    }
    .dot.critical { background: var(--critical); }
    .dot.high { background: var(--high); }
    .dot.medium { background: var(--medium); }
    .dot.low { background: var(--low); }
    .edge {
      stroke: var(--line);
      stroke-width: 1.6;
      marker-end: url(#arrow);
    }
    .edge.cross-account {
      stroke: var(--cross);
      stroke-width: 2;
      stroke-dasharray: 8 5;
      marker-end: url(#cross-arrow);
    }
    .node circle {
      fill: var(--ok);
      stroke: #ffffff;
      stroke-width: 2.5;
      filter: drop-shadow(0 2px 5px rgba(23, 32, 42, 0.2));
    }
    .node[data-severity="critical"] circle { fill: var(--critical); }
    .node[data-severity="high"] circle { fill: var(--high); }
    .node[data-severity="medium"] circle { fill: var(--medium); }
    .node[data-severity="low"] circle { fill: var(--low); }
    .node text {
      pointer-events: none;
      font-size: 12px;
      fill: var(--ink);
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 4px;
      stroke-linejoin: round;
    }
    .node:hover circle,
    .edge:hover {
      stroke-width: 4;
    }
    #tooltip {
      position: fixed;
      z-index: 10;
      pointer-events: none;
      max-width: 360px;
      padding: 10px 12px;
      background: rgba(23, 32, 42, 0.94);
      color: #ffffff;
      border-radius: 6px;
      font-size: 12px;
      line-height: 1.45;
      opacity: 0;
      transform: translate(-9999px, -9999px);
      transition: opacity 120ms ease;
      white-space: pre-wrap;
    }
    footer {
      padding: 12px 24px;
      border-top: 1px solid #d9dee8;
      color: var(--muted);
      background: var(--panel);
      font-size: 12px;
    }
    @media (max-width: 900px) {
      header {
        align-items: flex-start;
        flex-direction: column;
      }
      main {
        grid-template-columns: 1fr;
      }
      aside {
        border-left: 0;
        border-top: 1px solid #d9dee8;
      }
    }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${nodes.length} nodes · ${edges.length} edges</div>
  </header>
  <main>
    <section class="canvas" aria-label="Dependency graph">
      <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="Stronghold dependency graph">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#8291a5"></path>
          </marker>
          <marker id="cross-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#b42318"></path>
          </marker>
        </defs>
        <g id="edges"></g>
        <g id="nodes"></g>
      </svg>
    </section>
    <aside>
      <h2>Legend</h2>
      <div class="legend">
        <div class="legend-row"><span class="swatch"></span><span>Intra-account dependency</span></div>
        <div class="legend-row"><span class="swatch cross"></span><span>Cross-account dependency</span></div>
        <div class="legend-row"><span class="dot critical"></span><span>Critical finding</span></div>
        <div class="legend-row"><span class="dot high"></span><span>High finding</span></div>
        <div class="legend-row"><span class="dot medium"></span><span>Medium finding</span></div>
        <div class="legend-row"><span class="dot low"></span><span>Low finding</span></div>
      </div>
    </aside>
  </main>
  <footer>AWS-visible infrastructure only</footer>
  <div id="tooltip" role="tooltip"></div>
  <script>
    const graph = ${toScriptJson({ nodes, edges })};
    const edgesLayer = document.getElementById('edges');
    const nodesLayer = document.getElementById('nodes');
    const tooltip = document.getElementById('tooltip');
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

    function showTooltip(event, lines) {
      tooltip.textContent = lines.filter(Boolean).join('\\n');
      tooltip.style.opacity = '1';
      moveTooltip(event);
    }

    function moveTooltip(event) {
      tooltip.style.transform = 'translate(' + (event.clientX + 14) + 'px, ' + (event.clientY + 14) + 'px)';
    }

    function hideTooltip() {
      tooltip.style.opacity = '0';
      tooltip.style.transform = 'translate(-9999px, -9999px)';
    }

    for (const edge of graph.edges) {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) continue;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'edge ' + edge.kind);
      line.setAttribute('x1', String(source.x));
      line.setAttribute('y1', String(source.y));
      line.setAttribute('x2', String(target.x));
      line.setAttribute('y2', String(target.y));
      line.addEventListener('mousemove', moveTooltip);
      line.addEventListener('mouseenter', (event) => showTooltip(event, [
        edge.label,
        'Type: ' + edge.type,
        'Source: ' + edge.source,
        'Target: ' + edge.target,
        edge.severity ? 'DR impact: ' + edge.severity : null,
        edge.metadata ? 'Metadata: ' + JSON.stringify(edge.metadata) : null
      ]));
      line.addEventListener('mouseleave', hideTooltip);
      edgesLayer.appendChild(line);
    }

    for (const node of graph.nodes) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'node');
      group.setAttribute('data-severity', node.severity || '');
      group.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '14');
      group.appendChild(circle);

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '20');
      text.setAttribute('y', '4');
      text.textContent = node.label;
      group.appendChild(text);

      group.addEventListener('mousemove', moveTooltip);
      group.addEventListener('mouseenter', (event) => showTooltip(event, [
        node.label,
        'Type: ' + node.type,
        node.accountId ? 'Account: ' + node.accountId : null,
        node.region ? 'Region: ' + node.region : null,
        node.service ? 'Service: ' + node.service : null,
        node.severity ? 'Highest finding: ' + node.severity : null,
        node.metadata ? 'Metadata: ' + JSON.stringify(node.metadata) : null,
        'ARN: ' + node.id
      ]));
      group.addEventListener('mouseleave', hideTooltip);
      nodesLayer.appendChild(group);
    }
  </script>
</body>
</html>`;
}

function serializeNodes(options: RenderGraphOptions): readonly RenderedGraphNode[] {
  const nodeIds = options.graph.nodes().sort((left, right) => left.localeCompare(right));
  const severityByNode = buildSeverityByNode(options.findings ?? []);
  const serviceByNode = buildServiceByNode(options.services ?? []);
  const total = Math.max(nodeIds.length, 1);

  return nodeIds.map((nodeId, index) => {
    const attrs = options.graph.getNodeAttributes(nodeId);
    const angle = (2 * Math.PI * index) / total - Math.PI / 2;
    const radius = nodeIds.length <= 1 ? 0 : RADIUS;

    return {
      id: nodeId,
      label: readLabel(attrs, nodeId),
      type: readString(attrs.type) ?? 'unknown',
      accountId: readString(attrs.accountId),
      region: readString(attrs.region),
      service: serviceByNode.get(nodeId) ?? readString(attrs.service),
      severity: severityByNode.get(nodeId) ?? null,
      metadata: readRecord(attrs.metadata),
      x: Math.round(CENTER_X + radius * Math.cos(angle)),
      y: Math.round(CENTER_Y + radius * Math.sin(angle)),
    };
  });
}

function serializeEdges(options: RenderGraphOptions): readonly RenderedGraphEdge[] {
  const edges: RenderedGraphEdge[] = [];

  options.graph.forEachEdge((edgeKey, attrs, source, target) => {
    void edgeKey;
    edges.push({
      source,
      target,
      type: readString(attrs.type) ?? 'DEPENDS_ON',
      kind: 'intra-account',
      severity: null,
      label: 'Intra-account dependency',
      metadata: readRecord(attrs.metadata),
    });
  });

  for (const edge of options.crossAccountEdges) {
    edges.push({
      source: edge.sourceArn,
      target: edge.targetArn,
      type: edge.kind,
      kind: 'cross-account',
      severity: edge.drImpact,
      label: 'Cross-account dependency',
      metadata: edge.metadata,
    });
  }

  return edges.sort(
    (left, right) =>
      left.source.localeCompare(right.source) ||
      left.target.localeCompare(right.target) ||
      left.type.localeCompare(right.type) ||
      left.kind.localeCompare(right.kind),
  );
}

function buildSeverityByNode(
  findings: readonly WeightedValidationResult[],
): ReadonlyMap<string, WeightedValidationResult['severity']> {
  const severityByNode = new Map<string, WeightedValidationResult['severity']>();

  for (const finding of findings) {
    if (finding.status !== 'fail' && finding.status !== 'warn' && finding.status !== 'error') {
      continue;
    }

    const previous = severityByNode.get(finding.nodeId);
    if (!previous || SEVERITY_RANK[finding.severity] > SEVERITY_RANK[previous]) {
      severityByNode.set(finding.nodeId, finding.severity);
    }
  }

  return severityByNode;
}

function buildServiceByNode(services: readonly Service[]): ReadonlyMap<string, string> {
  const serviceByNode = new Map<string, string>();

  for (const service of services) {
    for (const resource of service.resources) {
      serviceByNode.set(resource.nodeId, service.name);
    }
  }

  return serviceByNode;
}

function readLabel(attrs: Record<string, unknown>, fallback: string): string {
  return (
    readString(attrs.displayName) ??
    readString(attrs.businessName) ??
    readString(attrs.name) ??
    readString(attrs.resourceId) ??
    fallback
  );
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toScriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
