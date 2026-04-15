import type { RenderGraphHtmlOptions } from './graph-html-renderer-types.js';
import type {
  GraphVisualData,
  VisualEdge,
  VisualNode,
  VisualService,
} from './graph-visual-types.js';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 68;
const SCENE_PADDING = 28;

export function renderGraphHtml(
  data: GraphVisualData,
  options: RenderGraphHtmlOptions = {},
): string {
  const bounds = calculateSceneBounds(data);
  const viewBox = `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`;
  const dataJson = serializeInlineJson(data);
  const coverage = `${data.scenarios.filter((scenario) => scenario.verdict === 'covered').length}/${data.scenarios.length} covered`;
  const showWarning = data.nodes.some((node) => node.id.includes('arn:aws:'));
  const realityGapLabel =
    data.realityGap === null ? 'N/A' : data.realityGap === 0 ? '0 pts' : `${data.realityGap} pts`;
  const realityGapNote =
    data.provenRecoverability === null
      ? 'no services detected'
      : data.realityGap === 0
        ? 'No gap - DR posture is fully proven'
        : `claimed ${data.claimedProtection}% -> ${data.provenRecoverability}% proven`;
  const recoveryChainLabel = data.recoveryChain
    ? `${data.recoveryChain.provenSteps}/${data.recoveryChain.totalSteps} steps proven`
    : 'N/A';
  const recoveryChainNote = data.recoveryChain
    ? `${data.recoveryChain.weightedCoverage}% weighted coverage`
    : data.proofOfRecovery === null
      ? 'no services detected'
      : `${formatPercent(data.proofOfRecovery)} tested / ${data.observedCoverage}% observed`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stronghold DR Graph - ${escapeHtml(data.scanDate)}</title>
  <style>${buildStyles()}</style>
</head>
<body>
  <div id="header">
    <div class="stat"><div class="stat-label">Reality Gap</div><div class="stat-value">${formatRealityGapValue(realityGapLabel, data.realityGap)}</div><div class="stat-note">${escapeHtml(realityGapNote)}</div></div>
    <div class="stat"><div class="stat-label">Posture Score</div><div class="stat-value"><span>${data.globalScore}/100</span><span class="grade ${gradeClass(data.globalGrade)}">${escapeHtml(data.globalGrade)}</span></div><div class="stat-note">Stronghold DR posture as of ${escapeHtml(formatDate(data.scanDate))}</div></div>
    <div class="stat"><div class="stat-label">Recovery Chain</div><div class="stat-value">${escapeHtml(recoveryChainLabel)}</div><div class="stat-note">${escapeHtml(recoveryChainNote)}</div></div>
    <div class="stat"><div class="stat-label">Scenario Coverage</div><div class="stat-value">${escapeHtml(coverage)}</div><div class="stat-note">${data.scenarios.length} built-in scenarios available</div></div>
  </div>
  ${renderGapBar(data)}
  ${showWarning ? '<div id="warning">WARNING: This graph contains infrastructure identifiers. Use --redact for sharing.</div>' : ''}
  <div id="main">
    <section id="graph-panel">
      <div id="controls">
        <button id="zoom-in" type="button">Zoom In</button>
        <button id="zoom-out" type="button">Zoom Out</button>
        <button id="fit-view" type="button">Fit</button>
        <button id="reset-view" type="button">Reset</button>
        <button id="export-png" type="button">Export PNG</button>
        <select id="scenario-select" aria-label="Scenario selector">
          <option value="">Normal view</option>
          ${data.scenarios
            .map(
              (scenario) =>
                `<option value="${escapeAttribute(scenario.id)}">${escapeHtml(`${scenario.name} (${scenario.verdict.replace(/_/g, ' ')})`)}</option>`,
            )
            .join('')}
        </select>
      </div>
      <div id="graph-container">
        <svg id="graph" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="arrow-aws-api" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(203, 213, 225, 0.7)"></path></marker>
            <marker id="arrow-inferred" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148, 163, 184, 0.6)"></path></marker>
            <marker id="arrow-manual" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#f4a340"></path></marker>
          </defs>
          <g id="viewport">${renderServices(data.services)}${renderEdges(data.nodes, data.edges)}${renderNodes(data.nodes)}</g>
        </svg>
        <div id="tooltip"></div>
        <details id="legend" open>
          <summary>Legend</summary>
          <div class="legend-body">
            <div class="legend-row"><span class="legend-swatch" style="background:rgba(239,68,68,.18);border-color:#ef4444"></span><span>Critical direct impact</span></div>
            <div class="legend-row"><span class="legend-swatch" style="background:rgba(249,115,22,.16);border-color:#f97316"></span><span>Cascade impact</span></div>
            <div class="legend-row"><span class="legend-line" style="border-top-color:rgba(203,213,225,.7)"></span><span>AWS API edge</span></div>
            <div class="legend-row"><span class="legend-line" style="border-top-color:rgba(148,163,184,.6);border-top-style:dashed"></span><span>Inferred edge</span></div>
            <div class="legend-row"><span class="legend-line" style="border-top-color:#f4a340;border-top-style:dashed"></span><span>Manual edge</span></div>
          </div>
        </details>
      </div>
    </section>
    <aside id="sidebar">
      <div id="sidebar-head"><h2>Node Details</h2></div>
      <div id="sidebar-body">Select a node to inspect its service, reality gap, findings, and recovery posture.</div>
    </aside>
  </div>
  <script id="graph-data" type="application/json">${dataJson}</script>
  <script>${buildClientScript(options.initialScenarioId ?? null)}</script>
</body>
</html>`;
}

function renderGapBar(data: GraphVisualData): string {
  if (data.provenRecoverability === null || data.realityGap === null) {
    return '<div id="gap-strip" class="is-empty"><div id="gap-bar-head"><span>Reality gap visual</span><strong>N/A</strong></div></div>';
  }

  const provenWidth = clampPercent(data.provenRecoverability);
  const claimedWidth = clampPercent(data.claimedProtection);
  const gapWidth = clampPercent(Math.max(0, claimedWidth - provenWidth));
  const unclaimedWidth = Math.max(0, 100 - claimedWidth);

  return `<div id="gap-strip"><div id="gap-bar-head"><span><strong>${provenWidth}%</strong> proven</span><span>claimed ${claimedWidth}%</span></div><div id="gap-bar-wrap"><div class="gap-segment gap-proven" style="width:${provenWidth}%"></div><div class="gap-segment gap-gap" style="width:${gapWidth}%"></div><div class="gap-segment gap-unclaimed" style="width:${unclaimedWidth}%"></div><div id="gap-claimed-marker" style="left:${claimedWidth}%"></div><div id="gap-claimed-label" style="left:${claimedWidth}%">${claimedWidth}% claimed</div></div></div>`;
}

function formatRealityGapValue(value: string, gap: number | null): string {
  if (gap === null) {
    return `<span>${escapeHtml(value)}</span>`;
  }
  if (gap === 0) {
    return `<span style="color:#22c55e">${escapeHtml(value)}</span>`;
  }
  if (gap > 50) {
    return `<span style="color:#ef4444">${escapeHtml(value)}</span>`;
  }
  if (gap >= 20) {
    return `<span style="color:#eab308">${escapeHtml(value)}</span>`;
  }
  return `<span style="color:#22c55e">${escapeHtml(value)}</span>`;
}

function buildStyles(): string {
  return [
    ':root{color-scheme:dark;--bg:#0f1117;--sidebar:#161822;--line:rgba(148,163,184,.16);--line-strong:rgba(255,255,255,.08);--text:#f8fafc;--text-soft:#e2e8f0;--muted:#94a3b8;--critical:#ef4444;--high:#f97316;--medium:#eab308;--low:#22c55e;--gray:#6b7280;--manual:#f4a340}',
    '*{box-sizing:border-box}',
    'html,body{margin:0;min-height:100%;background:#0f1117;color:var(--text);font-family:"Segoe UI","Helvetica Neue",sans-serif}',
    'body{display:grid;grid-template-rows:auto auto auto 1fr}',
    '#header{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:20px 22px 16px;background:#0f1117;border-bottom:1px solid var(--line-strong);position:sticky;top:0;z-index:10}',
    '.stat{padding:14px 16px;border:1px solid var(--line);border-radius:18px;background:rgba(255,255,255,.025)}',
    '.stat-label{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}',
    '.stat-value{margin-top:10px;font-size:28px;font-weight:700;display:flex;align-items:baseline;gap:10px}',
    '.stat-note{margin-top:8px;font-size:13px;color:var(--muted)}',
    '.grade{display:inline-flex;align-items:center;justify-content:center;min-width:32px;padding:5px 10px;border-radius:999px;font-size:14px;font-weight:700}',
    '.grade-a,.grade-b{background:rgba(34,197,94,.2);border:1px solid rgba(34,197,94,.45)}',
    '.grade-c{background:rgba(234,179,8,.18);border:1px solid rgba(234,179,8,.45)}',
    '.grade-d{background:rgba(249,115,22,.18);border:1px solid rgba(249,115,22,.45)}',
    '.grade-f{background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.45)}',
    '#gap-strip{padding:0 22px 16px;background:#0f1117}',
    '#gap-strip.is-empty{padding-top:6px}',
    '#gap-bar-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:12px;color:var(--muted)}',
    '#gap-bar-head strong{color:var(--text)}',
    '#gap-bar-wrap{position:relative;height:18px;border-radius:999px;background:rgba(148,163,184,.14);overflow:hidden;border:1px solid var(--line)}',
    '.gap-segment{height:100%;float:left}',
    '.gap-proven{background:linear-gradient(90deg,rgba(34,197,94,.85),rgba(34,197,94,.65))}',
    '.gap-gap{background:linear-gradient(90deg,rgba(239,68,68,.9),rgba(239,68,68,.7))}',
    '.gap-unclaimed{background:rgba(148,163,184,.14)}',
    '#gap-claimed-marker{position:absolute;top:-4px;bottom:-4px;width:2px;background:#f8fafc;opacity:.9}',
    '#gap-claimed-label{position:absolute;top:-24px;transform:translateX(-50%);font-size:11px;color:var(--text-soft);white-space:nowrap}',
    '#warning{margin:0 22px 16px;padding:12px 14px;border-radius:16px;border:1px solid rgba(234,179,8,.45);background:rgba(234,179,8,.16);color:#fde68a;font-size:14px}',
    '#main{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:16px;padding:0 22px 22px;min-height:0}',
    '#graph-panel{border:1px solid var(--line);border-radius:24px;background:#0f1117;overflow:hidden}',
    '#sidebar{border:1px solid var(--line);border-radius:24px;background:#161822;overflow:hidden;display:flex;flex-direction:column}',
    '#controls{display:flex;flex-wrap:wrap;gap:10px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.06);background:transparent}',
    'button,select{border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.04);color:var(--text);padding:9px 12px;font:inherit}',
    'button{cursor:pointer}',
    '#scenario-select{min-width:220px;margin-left:auto}',
    '#graph-container{position:relative;height:calc(100vh - 214px);min-height:580px;background:#0f1117}',
    '#graph{width:100%;height:100%;display:block;cursor:grab;user-select:none}',
    '#graph.is-dragging{cursor:grabbing}',
    '.service-cluster rect{stroke-width:1.5}',
    '.service-label{font-size:12.5px;font-weight:600}',
    '.service-badge rect{fill:rgba(15,23,42,.78);stroke:rgba(148,163,184,.26);stroke-width:1}',
    '.service-badge text{fill:var(--text-soft);font-size:9.5px;font-weight:600;text-anchor:middle;dominant-baseline:middle}',
    '.graph-edge path{fill:none;stroke-width:2;opacity:.6;transition:opacity .15s ease,stroke-width .15s ease}',
    '.graph-edge text{fill:var(--text-soft);font-size:10px;pointer-events:none;text-anchor:middle;dominant-baseline:middle}',
    '.graph-edge .edge-label-bg{fill:rgba(15,17,23,.92);stroke:rgba(148,163,184,.2);stroke-width:1;rx:8;ry:8}',
    '.graph-edge.provenance-aws-api path{stroke:rgba(203,213,225,.7)}',
    '.graph-edge.provenance-inferred path{stroke:rgba(148,163,184,.6);stroke-dasharray:6 6;opacity:.4}',
    '.graph-edge.provenance-manual path{stroke:var(--manual);stroke-dasharray:10 6;opacity:.85}',
    '.graph-edge.is-active path{opacity:1;stroke-width:2.6}',
    '.graph-edge.is-dimmed path,.graph-edge.is-dimmed text{opacity:.15}',
    '.graph-node{cursor:pointer;transition:opacity .15s ease}',
    '.graph-node rect{fill:#151923;stroke-width:2.2;filter:drop-shadow(0 8px 20px rgba(0,0,0,.32))}',
    '.graph-node text{pointer-events:none}',
    '.graph-node .node-label{fill:var(--text);font-size:13px;font-weight:600}',
    '.graph-node .node-meta{fill:var(--muted);font-size:11px}',
    '.graph-node .node-icon path,.graph-node .node-icon line,.graph-node .node-icon circle,.graph-node .node-icon rect,.graph-node .node-icon polyline,.graph-node .node-icon ellipse{stroke:#94a3b8;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none}',
    '.graph-node.is-selected rect{fill:rgba(56,189,248,.12)}',
    '.graph-node.is-dimmed{opacity:.2}',
    '.graph-node.is-direct rect{fill:rgba(239,68,68,.18)!important;stroke:var(--critical)!important}',
    '.graph-node.is-cascade rect{fill:rgba(249,115,22,.16)!important;stroke:var(--high)!important}',
    '#tooltip{position:absolute;pointer-events:none;padding:10px 12px;border-radius:14px;background:rgba(15,17,23,.96);border:1px solid var(--line);color:var(--text);font-size:12px;line-height:1.45;min-width:180px;opacity:0;transform:translate(-9999px,-9999px);box-shadow:0 16px 40px rgba(0,0,0,.34)}',
    '#sidebar-head{padding:18px 18px 14px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.02)}',
    '#sidebar-head h2{margin:0;font-size:16px;font-weight:700}',
    '#sidebar-body{padding:18px;overflow:auto;font-size:14px;line-height:1.6;color:var(--muted)}',
    '.detail{display:grid;grid-template-columns:110px minmax(0,1fr);gap:12px;margin-bottom:8px}',
    '.detail-key{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}',
    '.detail-value{color:var(--text);word-break:break-word}',
    '.section{margin-bottom:18px}',
    '.section:last-child{margin-bottom:0}',
    '.section h3{margin:0 0 8px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--text)}',
    '.card{padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid var(--line);margin-bottom:10px}',
    '.card:last-child{margin-bottom:0}',
    '.bullet-list{margin:0;padding-left:18px;color:var(--text)}',
    '.bullet-list li{margin-bottom:6px}',
    '.pill-wrap{display:flex;flex-wrap:wrap;gap:8px}',
    '.pill{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:var(--text);font-size:12px}',
    'details#legend{position:absolute;right:16px;bottom:16px;width:250px;border-radius:18px;border:1px solid var(--line);background:rgba(15,17,23,.92);overflow:hidden}',
    'details#legend summary{padding:12px 14px;cursor:pointer;font-weight:600}',
    '.legend-body{padding:0 14px 14px;font-size:12px;color:var(--muted);line-height:1.6}',
    '.legend-row{display:flex;align-items:center;gap:10px;margin-top:8px}',
    '.legend-swatch,.legend-line{width:22px;flex:0 0 auto}',
    '.legend-swatch{height:12px;border-radius:6px;border:1px solid transparent}',
    '.legend-line{height:0;border-top:2px solid}',
    '@media (max-width:1120px){#header{grid-template-columns:repeat(2,minmax(0,1fr))}#main{grid-template-columns:minmax(0,1fr)}#graph-container{height:72vh}}',
    '@media (max-width:720px){#header{grid-template-columns:minmax(0,1fr)}#scenario-select{min-width:0;width:100%;margin-left:0}}',
  ].join('');
}

function buildClientScript(initialScenarioId: string | null): string {
  return [
    "const DATA = JSON.parse(document.getElementById('graph-data').textContent || '{}');",
    `const INITIAL_SCENARIO_ID = ${JSON.stringify(initialScenarioId)};`,
    "const svg = document.getElementById('graph');",
    "const viewport = document.getElementById('viewport');",
    "const tooltip = document.getElementById('tooltip');",
    "const sidebar = document.getElementById('sidebar-body');",
    "const select = document.getElementById('scenario-select');",
    "const nodeEls = Array.from(document.querySelectorAll('.graph-node'));",
    "const edgeEls = Array.from(document.querySelectorAll('.graph-edge'));",
    "const nodeMap = new Map(DATA.nodes.map((node) => [node.id, node]));",
    "const serviceMap = new Map(DATA.services.map((service) => [service.id, service]));",
    "const scenarioMap = new Map(DATA.scenarios.map((scenario) => [scenario.id, scenario]));",
    "const state = { hoveredNodeId: null, selectedNodeId: null, scenarioId: null, dragging: false, scale: 1, x: 0, y: 0, dragPoint: null };",
    "function esc(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;')}",
    "function applyTransform(){viewport.setAttribute('transform','translate(' + state.x + ' ' + state.y + ') scale(' + state.scale + ')')}",
    "function resetViewport(){state.scale=1;state.x=0;state.y=0;applyTransform()}",
    "function clamp(value,min,max){return Math.min(max,Math.max(min,value))}",
    "function pointFromClient(clientX,clientY){const point=svg.createSVGPoint();point.x=clientX;point.y=clientY;const matrix=svg.getScreenCTM();return matrix?point.matrixTransform(matrix.inverse()):{x:0,y:0}}",
    "function activeNodeId(){return state.hoveredNodeId || state.selectedNodeId}",
    "function renderSidebar(){const node = state.selectedNodeId ? nodeMap.get(state.selectedNodeId) : null; const scenario = state.scenarioId ? scenarioMap.get(state.scenarioId) : null; if(node){const service = node.serviceId ? serviceMap.get(node.serviceId) : null; const findings = (node.findings || []).slice(0,6).map((finding) => '<div class=\"card\"><strong>' + esc(finding.ruleId) + '</strong><br>' + esc(finding.severity.toUpperCase()) + ' - ' + esc(finding.message) + (finding.remediation ? '<br><span style=\"color:var(--muted)\">' + esc(finding.remediation) + '</span>' : '') + '</div>').join('') || '<div class=\"card\">No active findings on this node.</div>'; const recs = (node.recommendations || []).slice(0,6).map((title) => '<div class=\"card\">' + esc(title) + '</div>').join('') || '<div class=\"card\">No recommendations scoped to this node.</div>'; const reasoning = service && service.reasoning.length ? '<div class=\"section\"><h3>Reasoning</h3><ul class=\"bullet-list\">' + service.reasoning.map((bullet) => '<li>' + esc(bullet) + '</li>').join('') + '</ul></div>' : ''; const insights = service && service.insights.length ? '<div class=\"section\"><h3>Graph Insights</h3><ul class=\"bullet-list\">' + service.insights.map((bullet) => '<li>' + esc(bullet) + '</li>').join('') + '</ul></div>' : ''; const reality = service ? '<div class=\"section\"><h3>Reality Gap</h3><div class=\"detail\"><div class=\"detail-key\">Gap</div><div class=\"detail-value\">' + esc(service.realityGap + ' pts') + '</div></div><div class=\"detail\"><div class=\"detail-key\">Claimed</div><div class=\"detail-value\">' + esc(service.claimedProtection + '% protected') + '</div></div><div class=\"detail\"><div class=\"detail-key\">Proven</div><div class=\"detail-value\">' + esc(service.provenRecoverability + '% recoverable') + '</div></div></div>' : ''; const recoveryChain = service && service.recoveryChain ? '<div class=\"section\"><h3>Recovery Chain</h3><div class=\"card\"><strong>' + service.recoveryChain.provenSteps + '/' + service.recoveryChain.totalSteps + ' proven</strong> | ' + service.recoveryChain.weightedCoverage + '% weighted</div><ul class=\"bullet-list\">' + service.recoveryChain.steps.map((entry) => '<li>' + esc(entry.status === 'proven' ? '✓' : entry.status === 'blocked' ? '✗' : entry.status === 'observed' ? '~' : '?') + ' ' + entry.resourceName).join('') + '</ul></div>' : ''; const nextAction = service && service.nextAction ? '<div class=\"section\"><h3>Next Action</h3><div class=\"card\">' + esc(service.nextAction) + '</div></div>' : ''; sidebar.innerHTML = '<div class=\"section\">' + '<div class=\"detail\"><div class=\"detail-key\">Resource</div><div class=\"detail-value\">' + esc(node.label) + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">Type</div><div class=\"detail-value\">' + esc(node.type) + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">Service</div><div class=\"detail-value\">' + esc(node.serviceName || 'Unassigned') + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">Region</div><div class=\"detail-value\">' + esc(node.region + (node.az ? ' - ' + node.az : '')) + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">Severity</div><div class=\"detail-value\">' + esc((node.worstSeverity || 'none').toUpperCase()) + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">DR Score</div><div class=\"detail-value\">' + esc(node.drScore === null ? 'n/a' : node.drScore + '/100') + '</div></div>' + '</div>' + reality + recoveryChain + reasoning + insights + nextAction + '<div class=\"section\"><h3>Findings</h3>' + findings + '</div><div class=\"section\"><h3>Recommendations</h3>' + recs + '</div>'; return;} if(scenario){const down = scenario.downServices.length ? scenario.downServices.map((name) => '<span class=\"pill\">' + esc(name) + '</span>').join('') : '<span class=\"pill\">None</span>'; const degraded = scenario.degradedServices.length ? scenario.degradedServices.map((name) => '<span class=\"pill\">' + esc(name) + '</span>').join('') : '<span class=\"pill\">None</span>'; sidebar.innerHTML = '<div class=\"section\">' + '<div class=\"detail\"><div class=\"detail-key\">Scenario</div><div class=\"detail-value\">' + esc(scenario.name) + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">Type</div><div class=\"detail-value\">' + esc(scenario.type) + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">Coverage</div><div class=\"detail-value\">' + esc(String(scenario.verdict).replace(/_/g,' ')) + '</div></div>' + '<div class=\"detail\"><div class=\"detail-key\">Affected</div><div class=\"detail-value\">' + scenario.affectedNodeIds.length + ' nodes</div></div>' + '</div><div class=\"section\"><h3>Services Down</h3><div class=\"pill-wrap\">' + down + '</div></div><div class=\"section\"><h3>Services Degraded</h3><div class=\"pill-wrap\">' + degraded + '</div></div><div class=\"section\"><h3>Summary</h3><div class=\"detail-value\">' + esc(scenario.summary || 'No additional coverage summary available.') + '</div></div>'; return;} sidebar.textContent = 'Select a node to inspect its service, reality gap, findings, and recovery posture.';}",
    "function refresh(){const focus = activeNodeId(); const scenario = state.scenarioId ? scenarioMap.get(state.scenarioId) : null; const direct = new Set(scenario ? scenario.directlyAffectedNodeIds : []); const cascade = new Set(scenario ? scenario.cascadeNodeIds : []); const affected = new Set(scenario ? scenario.affectedNodeIds : []); nodeEls.forEach((el) => { const id = el.getAttribute('data-node-id'); el.classList.toggle('is-selected', Boolean(id && id === state.selectedNodeId)); el.classList.toggle('is-direct', Boolean(id && direct.has(id))); el.classList.toggle('is-cascade', Boolean(id && cascade.has(id))); el.classList.toggle('is-dimmed', Boolean(scenario && id && !affected.has(id))); }); edgeEls.forEach((el) => { const source = el.getAttribute('data-source'); const target = el.getAttribute('data-target'); const related = focus && (source === focus || target === focus); const scenarioRelated = Boolean(scenario && source && target && affected.has(source) && affected.has(target)); el.classList.toggle('is-active', Boolean(related || scenarioRelated)); el.classList.toggle('is-dimmed', Boolean(scenario ? !scenarioRelated && !related : focus ? !related : false)); }); renderSidebar();}",
    "nodeEls.forEach((el) => { el.addEventListener('mouseenter', () => { state.hoveredNodeId = el.getAttribute('data-node-id'); const node = nodeMap.get(state.hoveredNodeId); if(node){tooltip.innerHTML = '<strong>' + esc(node.label) + '</strong><br>' + esc(node.type) + ' - ' + esc(node.region) + '<br>' + node.findingCount + ' findings - ' + esc((node.worstSeverity || 'none').toUpperCase()); tooltip.style.opacity = '1'} refresh(); }); el.addEventListener('mousemove', (event) => { tooltip.style.transform = 'translate(' + (event.clientX + 18) + 'px,' + (event.clientY + 18) + 'px)' }); el.addEventListener('mouseleave', () => { state.hoveredNodeId = null; tooltip.style.opacity = '0'; tooltip.style.transform = 'translate(-9999px,-9999px)'; refresh() }); el.addEventListener('click', () => { state.selectedNodeId = el.getAttribute('data-node-id'); refresh() }); });",
    "svg.addEventListener('mousedown', (event) => { if(event.target.closest('.graph-node')) return; state.dragging = true; state.dragPoint = pointFromClient(event.clientX,event.clientY); svg.classList.add('is-dragging') });",
    "window.addEventListener('mousemove', (event) => { if(!state.dragging || !state.dragPoint) return; const next = pointFromClient(event.clientX,event.clientY); state.x += next.x - state.dragPoint.x; state.y += next.y - state.dragPoint.y; state.dragPoint = next; applyTransform() });",
    "window.addEventListener('mouseup', () => { state.dragging = false; state.dragPoint = null; svg.classList.remove('is-dragging') });",
    "svg.addEventListener('wheel', (event) => { event.preventDefault(); const point = pointFromClient(event.clientX,event.clientY); const nextScale = clamp(state.scale * (event.deltaY < 0 ? 1.12 : 0.9), 0.4, 3.2); const sceneX = (point.x - state.x) / state.scale; const sceneY = (point.y - state.y) / state.scale; state.scale = nextScale; state.x = point.x - sceneX * nextScale; state.y = point.y - sceneY * nextScale; applyTransform() }, { passive:false });",
    "document.getElementById('zoom-in').addEventListener('click', () => { state.scale = clamp(state.scale * 1.15, 0.4, 3.2); applyTransform() });",
    "document.getElementById('zoom-out').addEventListener('click', () => { state.scale = clamp(state.scale * 0.87, 0.4, 3.2); applyTransform() });",
    "document.getElementById('fit-view').addEventListener('click', resetViewport);",
    "document.getElementById('reset-view').addEventListener('click', () => { state.selectedNodeId = null; state.hoveredNodeId = null; state.scenarioId = null; select.value = ''; resetViewport(); refresh() });",
    "select.addEventListener('change', () => { state.scenarioId = select.value || null; state.selectedNodeId = null; refresh() });",
    "document.getElementById('export-png').addEventListener('click', () => { const source = new XMLSerializer().serializeToString(svg); const image = new Image(); const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob); const viewBox = svg.viewBox.baseVal; const canvas = document.createElement('canvas'); canvas.width = Math.max(1200, Math.ceil(viewBox.width * 1.5)); canvas.height = Math.max(700, Math.ceil(viewBox.height * 1.5)); const context = canvas.getContext('2d'); image.onload = () => { context.fillStyle = '#0f1117'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0,canvas.width,canvas.height); URL.revokeObjectURL(url); const link = document.createElement('a'); link.download = 'stronghold-graph.png'; link.href = canvas.toDataURL('image/png'); link.click() }; image.src = url });",
    "if(INITIAL_SCENARIO_ID && scenarioMap.has(INITIAL_SCENARIO_ID)){ state.scenarioId = INITIAL_SCENARIO_ID; select.value = INITIAL_SCENARIO_ID }",
    'resetViewport();',
    'refresh();',
  ].join('');
}

function renderServices(services: readonly VisualService[]): string {
  return services
    .map((service) => {
      const palette = clusterPalette(service.grade);
      const gradeColor = gradeAccent(service.grade);
      const scoreColor = gradeAccentMuted(service.grade);
      const badgeWidth = 72;
      const badgeHeight = 18;
      const badgeX = service.x + service.width - badgeWidth - 10;
      const badgeY = service.y + 5;
      const labelLimit = Math.max(9, Math.floor((service.width - badgeWidth - 42) / 6.8));
      const findingLabel = service.findingCount === 1 ? '1 finding' : `${service.findingCount} findings`;
      return `<g class="service-cluster" data-service-id="${escapeAttribute(service.id)}"><rect x="${service.x}" y="${service.y}" width="${service.width}" height="${service.height}" rx="12" ry="12" fill="${palette.fill}" stroke="${palette.stroke}"></rect><text class="service-label" x="${service.x + 10}" y="${service.y + 17}"><tspan fill="#e2e8f0">${escapeHtml(`${truncate(service.name, labelLimit)} `)}</tspan><tspan fill="${gradeColor}">${escapeHtml(service.grade)}</tspan><tspan fill="${scoreColor}">${escapeHtml(` ${service.score}/100`)}</tspan></text><g class="service-badge" transform="translate(${badgeX} ${badgeY})"><rect x="0" y="0" width="${badgeWidth}" height="${badgeHeight}" rx="9" ry="9"></rect><text x="${badgeWidth / 2}" y="${badgeHeight / 2 + 0.5}">${escapeHtml(findingLabel)}</text></g></g>`;
    })
    .join('');
}

function renderEdges(nodes: readonly VisualNode[], edges: readonly VisualEdge[]): string {
  return buildEdgeRenderModels(nodes, edges)
    .map((edge) => {
      const labelWidth = estimateEdgeLabelWidth(edge.label);
      const labelHeight = 18;
      return `<g class="graph-edge provenance-${escapeAttribute(edge.provenance)}" data-edge-id="${escapeAttribute(edge.id)}" data-source="${escapeAttribute(edge.source)}" data-target="${escapeAttribute(edge.target)}"><path d="${edge.path}" marker-end="url(#arrow-${escapeAttribute(edge.provenance)})"></path><rect class="edge-label-bg" x="${edge.labelX - labelWidth / 2}" y="${edge.labelY - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="8" ry="8"></rect><text x="${edge.labelX}" y="${edge.labelY + 0.5}">${escapeHtml(edge.label)}</text></g>`;
    })
    .join('');
}

function renderNodes(nodes: readonly VisualNode[]): string {
  return nodes
    .map((node) => {
      const left = node.x - NODE_WIDTH / 2;
      const top = node.y - NODE_HEIGHT / 2;
      return `<g class="graph-node" data-node-id="${escapeAttribute(node.id)}" transform="translate(${left} ${top})"><title>${escapeHtml(node.label)}</title><rect x="0" y="0" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="20" ry="20" stroke="${severityColor(node.worstSeverity, node.serviceId)}"></rect><g class="node-icon" transform="translate(12 24)">${iconMarkupForType(node.type)}</g><text class="node-label" x="44" y="29">${escapeHtml(truncate(node.label, 22))}</text><text class="node-meta" x="44" y="48">${escapeHtml(truncate(`${node.type} - ${node.region}`, 26))}</text></g>`;
    })
    .join('');
}

function calculateSceneBounds(data: GraphVisualData): {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  data.nodes.forEach((node) => {
    minX = Math.min(minX, node.x - NODE_WIDTH / 2 - SCENE_PADDING);
    minY = Math.min(minY, node.y - NODE_HEIGHT / 2 - SCENE_PADDING);
    maxX = Math.max(maxX, node.x + NODE_WIDTH / 2 + SCENE_PADDING);
    maxY = Math.max(maxY, node.y + NODE_HEIGHT / 2 + SCENE_PADDING);
  });
  data.services.forEach((service) => {
    minX = Math.min(minX, service.x - SCENE_PADDING);
    minY = Math.min(minY, service.y - SCENE_PADDING);
    maxX = Math.max(maxX, service.x + service.width + SCENE_PADDING);
    maxY = Math.max(maxY, service.y + service.height + SCENE_PADDING);
  });

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return { minX: 0, minY: 0, width: 960, height: 600 };
  }

  return {
    minX: Math.max(0, minX),
    minY: Math.max(0, minY),
    width: Math.max(960, maxX - minX),
    height: Math.max(600, maxY - minY),
  };
}

function createEdgePath(source: VisualNode, target: VisualNode): string {
  const startX = source.x + NODE_WIDTH / 2;
  const endX = target.x - NODE_WIDTH / 2;
  const curve = Math.max(48, Math.abs(endX - startX) * 0.35);
  return `M ${startX} ${source.y} C ${startX + curve} ${source.y}, ${endX - curve} ${target.y}, ${endX} ${target.y}`;
}

function buildEdgeRenderModels(
  nodes: readonly VisualNode[],
  edges: readonly VisualEdge[],
): ReadonlyArray<{
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly provenance: VisualEdge['provenance'];
  readonly label: string;
  readonly path: string;
  readonly labelX: number;
  readonly labelY: number;
}> {
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));
  const grouped = new Map<
    string,
    Array<{ readonly edge: VisualEdge; readonly index: number; readonly source: VisualNode; readonly target: VisualNode }>
  >();

  edges.forEach((edge, index) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      return;
    }

    const groupKey = edgeGroupKey(source, target);
    const current = grouped.get(groupKey) ?? [];
    current.push({ edge, index, source, target });
    grouped.set(groupKey, current);
  });

  const models = Array.from(grouped.values()).flatMap((group) => {
    const offsets = centeredOffsets(group.length, 22);
    return group.map(({ edge, index, source, target }, groupIndex) => {
      const startX = source.x + NODE_WIDTH / 2;
      const endX = target.x - NODE_WIDTH / 2;
      const midpoint = { x: (source.x + target.x) / 2, y: (source.y + target.y) / 2 - 10 };
      const vectorX = endX - startX;
      const vectorY = target.y - source.y;
      const length = Math.hypot(vectorX, vectorY) || 1;
      const normalX = -vectorY / length;
      const normalY = vectorX / length;
      const distance = offsets[groupIndex] ?? 0;

      return {
        id: `edge-${index}`,
        source: edge.source,
        target: edge.target,
        provenance: edge.provenance,
        label: edge.label,
        path: createEdgePath(source, target),
        labelX: midpoint.x + normalX * distance,
        labelY: midpoint.y + normalY * distance,
      };
    });
  });

  return resolveEdgeLabelCollisions(models);
}

function edgeGroupKey(source: VisualNode, target: VisualNode): string {
  if (source.serviceId && source.serviceId === target.serviceId) {
    return `service:${source.serviceId}`;
  }

  const left = source.serviceId ?? source.id;
  const right = target.serviceId ?? target.id;
  return left.localeCompare(right) <= 0 ? `${left}::${right}` : `${right}::${left}`;
}

function centeredOffsets(count: number, step: number): readonly number[] {
  if (count <= 1) {
    return [0];
  }

  return Array.from({ length: count }, (_value, index) => (index - (count - 1) / 2) * step);
}

function resolveEdgeLabelCollisions<
  T extends { readonly label: string; readonly labelX: number; readonly labelY: number },
>(models: readonly T[]): readonly T[] {
  const placed: Array<{ readonly left: number; readonly right: number; readonly top: number; readonly bottom: number }> = [];
  const resolved: T[] = [];
  const gap = 6;
  const labelHeight = 18;

  models
    .slice()
    .sort((left, right) => left.labelX - right.labelX || left.labelY - right.labelY)
    .forEach((model) => {
      const width = estimateEdgeLabelWidth(model.label);
      let labelY = model.labelY;
      let box = createLabelBox(model.labelX, labelY, width, labelHeight);
      let didMove = true;

      while (didMove) {
        didMove = false;

        for (const previous of placed) {
          if (
            Math.min(box.right, previous.right) > Math.max(box.left, previous.left) &&
            Math.min(box.bottom, previous.bottom) > Math.max(box.top, previous.top)
          ) {
            labelY = previous.bottom + gap + labelHeight / 2;
            box = createLabelBox(model.labelX, labelY, width, labelHeight);
            didMove = true;
          }
        }
      }

      resolved.push({
        ...model,
        labelY,
      });
      placed.push(box);
    });

  return resolved;
}

function createLabelBox(centerX: number, centerY: number, width: number, height: number): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  return {
    left: centerX - width / 2,
    right: centerX + width / 2,
    top: centerY - height / 2,
    bottom: centerY + height / 2,
  };
}

function estimateEdgeLabelWidth(label: string): number {
  return Math.max(54, Math.min(110, label.length * 6.4 + 18));
}

function clusterPalette(grade: string): { readonly fill: string; readonly stroke: string } {
  const normalized = grade.toUpperCase();
  if (normalized === 'A' || normalized === 'B') {
    return { fill: 'rgba(34, 197, 94, 0.12)', stroke: 'rgba(34, 197, 94, 0.4)' };
  }
  if (normalized === 'C' || normalized === 'D') {
    return { fill: 'rgba(234, 179, 8, 0.12)', stroke: 'rgba(234, 179, 8, 0.4)' };
  }
  return { fill: 'rgba(239, 68, 68, 0.12)', stroke: 'rgba(239, 68, 68, 0.4)' };
}

function gradeAccent(grade: string): string {
  const normalized = grade.toUpperCase();
  if (normalized === 'A' || normalized === 'B') return '#22c55e';
  if (normalized === 'C') return '#eab308';
  if (normalized === 'D') return '#f97316';
  return '#ef4444';
}

function gradeAccentMuted(grade: string): string {
  const normalized = grade.toUpperCase();
  if (normalized === 'A' || normalized === 'B') return 'rgba(34, 197, 94, 0.82)';
  if (normalized === 'C') return 'rgba(234, 179, 8, 0.82)';
  if (normalized === 'D') return 'rgba(249, 115, 22, 0.82)';
  return 'rgba(239, 68, 68, 0.82)';
}

function severityColor(severity: string | null, serviceId: string | null): string {
  if (severity === 'critical') return '#ef4444';
  if (severity === 'high') return '#f97316';
  if (severity === 'medium') return '#eab308';
  if (severity === 'low' || serviceId !== null) return '#22c55e';
  return '#6b7280';
}

function gradeClass(grade: string): string {
  return `grade-${grade.toLowerCase()}`;
}

function iconMarkupForType(type: string): string {
  const value = type.toLowerCase();
  if (value.includes('dynamodb')) {
    return '<ellipse cx="10" cy="4.5" rx="5.5" ry="2.5"></ellipse><path d="M4.5 4.5v8.5c0 1.7 11 1.7 11 0V4.5"></path><path d="M4.5 8.5c0 1.7 11 1.7 11 0"></path><path d="M9 8l-1.2 3h1.5L8.6 14l3-4h-1.6l1-2z"></path>';
  }
  if (value.includes('rds') || value.includes('aurora') || value.includes('database')) {
    return '<ellipse cx="10" cy="4.5" rx="5.5" ry="2.5"></ellipse><path d="M4.5 4.5v8.5c0 1.7 11 1.7 11 0V4.5"></path><path d="M4.5 8.5c0 1.7 11 1.7 11 0"></path><path d="M4.5 12c0 1.7 11 1.7 11 0"></path>';
  }
  if (value.includes('s3') || value.includes('storage')) {
    return '<path d="M6 3.5h8l1.4 3.8v6.7A2 2 0 0 1 13.4 16H6.6a2 2 0 0 1-2-2V7.3L6 3.5z"></path><path d="M4.9 7.8h10.2"></path>';
  }
  if (value.includes('lambda') || value.includes('serverless')) {
    return '<path d="M7 4l4 12"></path><path d="M11 16l4-4"></path><path d="M8.5 10h6"></path>';
  }
  if (value.includes('ecs') || value.includes('eks') || value.includes('container')) {
    return '<rect x="4" y="4" width="7" height="5" rx="1.4"></rect><rect x="9" y="7.5" width="7" height="5" rx="1.4"></rect><rect x="4" y="11" width="7" height="5" rx="1.4"></rect>';
  }
  if (value.includes('ec2') || value.includes('asg') || value.includes('vm') || value.includes('compute')) {
    return '<rect x="3" y="4" width="14" height="10.5" rx="2"></rect><path d="M6 17h8"></path><path d="M10 14.5V17"></path><path d="M6.5 8h7"></path>';
  }
  if (value.includes('elb') || value.includes('load')) {
    return '<path d="M4 6h4"></path><path d="M4 14h4"></path><path d="M8 10h4"></path><path d="M12 5l4 5-4 5"></path>';
  }
  if (value.includes('elasticache') || value.includes('cache')) {
    return '<ellipse cx="10" cy="5" rx="5.2" ry="2.3"></ellipse><path d="M4.8 5v6.8c0 1.6 10.4 1.6 10.4 0V5"></path><path d="M7 10h6"></path><path d="M8 13h4"></path>';
  }
  if (value.includes('sqs') || value.includes('queue')) {
    return '<rect x="4" y="5" width="12" height="9.5" rx="2"></rect><path d="M7 8h6"></path><path d="M7 11h6"></path><path d="M10 14.5l2 2 2-2"></path>';
  }
  if (value.includes('sns') || value.includes('notification')) {
    return '<path d="M6 8a4 4 0 1 1 8 0c0 3.8 2 4.2 2 5H4c0-.8 2-1.2 2-5"></path><path d="M9 16a1.5 1.5 0 0 0 2 0"></path>';
  }
  if (value.includes('route53') || value.includes('dns')) {
    return '<circle cx="10" cy="10" r="6"></circle><path d="M4 10h12"></path><path d="M10 4c2 2 2 10 0 12"></path><path d="M10 4c-2 2-2 10 0 12"></path>';
  }
  if (value.includes('efs') || value.includes('file')) {
    return '<path d="M3 7h5l2 2h7v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path>';
  }
  if (value.includes('vpc') || value.includes('subnet') || value.includes('network')) {
    return '<circle cx="5" cy="10" r="2"></circle><circle cx="15" cy="5" r="2"></circle><circle cx="15" cy="15" r="2"></circle><path d="M7 9l6-3"></path><path d="M7 11l6 3"></path>';
  }
  if (value.includes('cloudwatch') || value.includes('monitor')) {
    return '<path d="M4 15h12"></path><path d="M5 13l3-4 3 2 4-5"></path>';
  }
  if (value.includes('backup')) {
    return '<path d="M10 3l6 3v4c0 4-2.5 6-6 7-3.5-1-6-3-6-7V6l6-3z"></path><path d="M9 10h4"></path><path d="M11 8l2 2-2 2"></path>';
  }
  if (value.includes('security')) {
    return '<path d="M10 3l6 3v4c0 4-2.5 6-6 7-3.5-1-6-3-6-7V6l6-3z"></path><path d="M7.5 10.5l1.8 1.8L12.8 9"></path>';
  }
  return '<path d="M10 3l6 3.5v7L10 17l-6-3.5v-7L10 3z"></path><path d="M10 3v14"></path><path d="M4 6.5l6 3.5 6-3.5"></path>';
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 3))}...`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : value;
}

function formatPercent(value: number | null): string {
  return `${value ?? 0}%`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
