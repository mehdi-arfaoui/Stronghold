import { performance } from 'node:perf_hooks';
import dagre from 'dagre';
import cytoscape from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';

cytoscape.use(cytoscapeDagre);

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateSyntheticGraph(nodeCount) {
  const layerSize = Math.max(8, Math.round(Math.sqrt(nodeCount)));
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const layer = Math.floor(index / layerSize);
    return {
      id: `n-${index}`,
      layer,
    };
  });

  const edges = [];
  for (let index = 1; index < nodeCount; index += 1) {
    const sourceLayer = Math.max(0, Math.floor(index / layerSize) - randomInt(1, 2));
    const sourceStart = sourceLayer * layerSize;
    const sourceEnd = Math.min(nodeCount - 1, sourceStart + layerSize - 1);
    const source = randomInt(sourceStart, sourceEnd);
    edges.push({
      id: `e-seed-${index}`,
      source: `n-${source}`,
      target: `n-${index}`,
    });
  }

  const extraEdges = Math.max(nodeCount, Math.floor(nodeCount * 1.8));
  for (let idx = 0; idx < extraEdges; idx += 1) {
    const target = randomInt(1, nodeCount - 1);
    const minSource = Math.max(0, target - layerSize * 3);
    const source = randomInt(minSource, target - 1);
    if (source === target) continue;
    edges.push({
      id: `e-extra-${idx}`,
      source: `n-${source}`,
      target: `n-${target}`,
    });
  }

  return { nodes, edges };
}

function measureLegacyRenderPrep(nodes, edges) {
  const start = performance.now();
  nodes.map((node) => ({
    id: node.id,
    type: 'infraNode',
    position: { x: 0, y: 0 },
    data: { label: node.id },
  }));
  edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: 'smoothstep',
  }));
  return performance.now() - start;
}

function measureLegacyDagreLayout(nodes, edges) {
  const start = performance.now();
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'LR',
    ranksep: 130,
    nodesep: 70,
  });

  for (const node of nodes) {
    graph.setNode(node.id, {
      width: 220,
      height: 70,
      rank: node.layer,
    });
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  return performance.now() - start;
}

function buildCytoscapeElements(nodes, edges) {
  const start = performance.now();
  const elements = [
    ...nodes.map((node) => ({
      group: 'nodes',
      data: {
        id: node.id,
        label: node.id,
      },
    })),
    ...edges.map((edge) => ({
      group: 'edges',
      data: {
        id: edge.id,
        source: edge.source,
        target: edge.target,
      },
    })),
  ];
  return {
    elements,
    durationMs: performance.now() - start,
  };
}

async function measureCytoscapeLayout(elements) {
  const initStart = performance.now();
  const cy = cytoscape({
    headless: true,
    styleEnabled: false,
    elements,
  });
  const initMs = performance.now() - initStart;

  const layoutStart = performance.now();
  await new Promise((resolve) => {
    const layout = cy.layout({
      name: 'dagre',
      rankDir: 'LR',
      rankSep: 130,
      nodeSep: 70,
      animate: false,
      fit: false,
    });
    layout.one('layoutstop', resolve);
    layout.run();
  });
  const layoutMs = performance.now() - layoutStart;

  const snapshotStart = performance.now();
  cy.nodes().forEach((node) => node.position());
  const snapshotMs = performance.now() - snapshotStart;
  cy.destroy();

  return {
    initMs,
    layoutMs,
    snapshotMs,
  };
}

function toFixed(value) {
  return Number(value).toFixed(2);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function runBenchmark() {
  const sizes = [100, 300, 600];
  const iterations = 2;
  const results = [];

  for (const size of sizes) {
    const metrics = {
      legacyRenderPrep: [],
      legacyLayout: [],
      cyElementBuild: [],
      cyInit: [],
      cyLayout: [],
      cySnapshot: [],
    };

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const { nodes, edges } = generateSyntheticGraph(size);
      metrics.legacyRenderPrep.push(measureLegacyRenderPrep(nodes, edges));
      metrics.legacyLayout.push(measureLegacyDagreLayout(nodes, edges));

      const { elements, durationMs } = buildCytoscapeElements(nodes, edges);
      metrics.cyElementBuild.push(durationMs);
      const cyMetrics = await measureCytoscapeLayout(elements);
      metrics.cyInit.push(cyMetrics.initMs);
      metrics.cyLayout.push(cyMetrics.layoutMs);
      metrics.cySnapshot.push(cyMetrics.snapshotMs);
    }

    const legacyTotal = average(metrics.legacyRenderPrep) + average(metrics.legacyLayout);
    const cyTotal = average(metrics.cyElementBuild) + average(metrics.cyInit) + average(metrics.cyLayout) + average(metrics.cySnapshot);
    const gainPercent = ((legacyTotal - cyTotal) / legacyTotal) * 100;

    results.push({
      size,
      legacyRenderPrep: average(metrics.legacyRenderPrep),
      legacyLayout: average(metrics.legacyLayout),
      cyElementBuild: average(metrics.cyElementBuild),
      cyInit: average(metrics.cyInit),
      cyLayout: average(metrics.cyLayout),
      cySnapshot: average(metrics.cySnapshot),
      legacyTotal,
      cyTotal,
      gainPercent,
    });
  }

  console.log(`\nDiscovery Graph Benchmark (ms, moyenne sur ${iterations} iterations)\n`);
  console.log(
    [
      'Noeuds'.padEnd(8),
      'Legacy prep'.padEnd(12),
      'Legacy layout'.padEnd(14),
      'Cy build'.padEnd(10),
      'Cy init'.padEnd(10),
      'Cy layout'.padEnd(11),
      'Cy snapshot'.padEnd(13),
      'Total legacy'.padEnd(13),
      'Total cy'.padEnd(10),
      'Gain %',
    ].join(' | '),
  );

  for (const row of results) {
    console.log(
      [
        String(row.size).padEnd(8),
        toFixed(row.legacyRenderPrep).padEnd(12),
        toFixed(row.legacyLayout).padEnd(14),
        toFixed(row.cyElementBuild).padEnd(10),
        toFixed(row.cyInit).padEnd(10),
        toFixed(row.cyLayout).padEnd(11),
        toFixed(row.cySnapshot).padEnd(13),
        toFixed(row.legacyTotal).padEnd(13),
        toFixed(row.cyTotal).padEnd(10),
        `${toFixed(row.gainPercent)}%`,
      ].join(' | '),
    );
  }
}

runBenchmark().catch((error) => {
  console.error('Benchmark error:', error);
  process.exitCode = 1;
});
