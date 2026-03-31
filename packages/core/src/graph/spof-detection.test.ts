import { describe, it, expect } from 'vitest';
import { NodeType, EdgeType } from '../types/index.js';
import type { GraphInstance } from './graph-instance.js';
import { detectSPOFs, findArticulationPoints } from './spof-detection.js';
import { DEFAULT_RESOLVER } from './analysis-helpers.js';

type NodeStore = Record<string, Record<string, unknown>>;
type EdgeStore = Record<string, { source: string; target: string; attrs: Record<string, unknown> }>;

function buildGraph(
  nodes: Array<{ id: string; attrs: Record<string, unknown> }>,
  edges: Array<{ key: string; source: string; target: string; attrs?: Record<string, unknown> }>,
): GraphInstance {
  const nodeStore: NodeStore = {};
  const edgeStore: EdgeStore = {};

  for (const n of nodes) nodeStore[n.id] = { ...n.attrs };
  for (const e of edges)
    edgeStore[e.key] = { source: e.source, target: e.target, attrs: { ...e.attrs } };

  const outNeighborsOf = (key: string): string[] =>
    Object.values(edgeStore)
      .filter((e) => e.source === key)
      .map((e) => e.target);
  const inNeighborsOf = (key: string): string[] =>
    Object.values(edgeStore)
      .filter((e) => e.target === key)
      .map((e) => e.source);
  const outEdgesOf = (key: string): string[] =>
    Object.entries(edgeStore)
      .filter(([, e]) => e.source === key)
      .map(([k]) => k);

  const graph: GraphInstance = {
    get order() {
      return Object.keys(nodeStore).length;
    },
    get size() {
      return Object.keys(edgeStore).length;
    },
    addNode: (k, a) => {
      nodeStore[k] = a ?? {};
      return k;
    },
    addEdgeWithKey: (k, s, t, a) => {
      edgeStore[k] = { source: s, target: t, attrs: a ?? {} };
      return k;
    },
    hasNode: (k) => k in nodeStore,
    hasEdge: (k) => k in edgeStore,
    dropEdge: (k) => {
      delete edgeStore[k];
    },
    getNodeAttributes: (k) => nodeStore[k] ?? {},
    getEdgeAttributes: (k) => edgeStore[k]?.attrs ?? {},
    setNodeAttribute: (k, attr, val) => {
      if (nodeStore[k]) nodeStore[k]![attr] = val;
    },
    outNeighbors: outNeighborsOf,
    inNeighbors: inNeighborsOf,
    outEdges: outEdgesOf,
    inDegree: (k) => inNeighborsOf(k).length,
    outDegree: (k) => outNeighborsOf(k).length,
    nodes: () => Object.keys(nodeStore),
    edges: () => Object.keys(edgeStore),
    source: (k) => edgeStore[k]?.source ?? '',
    target: (k) => edgeStore[k]?.target ?? '',
    forEachNode: (cb) => {
      for (const [k, a] of Object.entries(nodeStore)) cb(k, a);
    },
    forEachEdge: (keyOrCb, cb?) => {
      if (typeof keyOrCb === 'function') {
        for (const [k, e] of Object.entries(edgeStore)) {
          keyOrCb(
            k,
            e.attrs,
            e.source,
            e.target,
            nodeStore[e.source] ?? {},
            nodeStore[e.target] ?? {},
          );
        }
      } else if (cb) {
        for (const [k, e] of Object.entries(edgeStore)) {
          if (e.source === keyOrCb || e.target === keyOrCb) {
            cb(
              k,
              e.attrs,
              e.source,
              e.target,
              nodeStore[e.source] ?? {},
              nodeStore[e.target] ?? {},
            );
          }
        }
      }
    },
    copy: () =>
      buildGraph(
        Object.entries(nodeStore).map(([id, attrs]) => ({ id, attrs: { ...attrs } })),
        Object.entries(edgeStore).map(([key, e]) => ({
          key,
          source: e.source,
          target: e.target,
          attrs: { ...e.attrs },
        })),
      ),
  };
  return graph;
}

function makeNode(
  id: string,
  type: string,
  name?: string,
): { id: string; attrs: Record<string, unknown> } {
  return {
    id,
    attrs: { id, name: name ?? id, type, provider: 'aws', region: 'eu-west-1', metadata: {} },
  };
}

function makeEdge(
  source: string,
  target: string,
  type = EdgeType.NETWORK_ACCESS,
): { key: string; source: string; target: string; attrs: Record<string, unknown> } {
  return { key: `${source}->${target}`, source, target, attrs: { type } };
}

describe('findArticulationPoints', () => {
  it('should detect a single bridge node', () => {
    const graph = buildGraph(
      [
        makeNode('A', NodeType.APPLICATION),
        makeNode('B', NodeType.DATABASE),
        makeNode('C', NodeType.CACHE),
      ],
      [makeEdge('A', 'B'), makeEdge('B', 'C')],
    );
    const ap = findArticulationPoints(graph);
    expect(ap.has('B')).toBe(true);
    expect(ap.has('A')).toBe(false);
    expect(ap.has('C')).toBe(false);
  });

  it('should return empty for a fully connected triangle', () => {
    const graph = buildGraph(
      [
        makeNode('A', NodeType.APPLICATION),
        makeNode('B', NodeType.DATABASE),
        makeNode('C', NodeType.CACHE),
      ],
      [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('C', 'A')],
    );
    const ap = findArticulationPoints(graph);
    expect(ap.size).toBe(0);
  });

  it('should return empty for an empty graph', () => {
    const graph = buildGraph([], []);
    const ap = findArticulationPoints(graph);
    expect(ap.size).toBe(0);
  });
});

describe('detectSPOFs', () => {
  it('should detect a database as SPOF when it is a bridge node', () => {
    const graph = buildGraph(
      [
        makeNode('lb', NodeType.LOAD_BALANCER, 'prod-alb'),
        makeNode('app', NodeType.APPLICATION, 'web-app'),
        makeNode('db', NodeType.DATABASE, 'main-rds'),
      ],
      [makeEdge('lb', 'app'), makeEdge('app', 'db')],
    );

    const spofs = detectSPOFs(graph, DEFAULT_RESOLVER);
    const dbSpof = spofs.find((s) => s.nodeId === 'db');
    expect(dbSpof).toBeDefined();
    expect(dbSpof?.nodeName).toBe('main-rds');
  });

  it('should exempt DynamoDB from SPOF detection', () => {
    const dynamoResolver = () => ({
      provider: 'aws' as const,
      category: 'database_nosql' as const,
      kind: 'dynamodb',
      nodeType: 'DATABASE',
      sourceType: 'aws_dynamodb_table',
      metadata: {},
      descriptors: [],
    });

    const graph = buildGraph(
      [
        makeNode('app', NodeType.APPLICATION, 'web-app'),
        makeNode('dynamo', NodeType.DATABASE, 'orders-table'),
        makeNode('cache', NodeType.CACHE, 'session-cache'),
      ],
      [makeEdge('app', 'dynamo'), makeEdge('dynamo', 'cache')],
    );

    const spofs = detectSPOFs(graph, dynamoResolver);
    const dynamoSpof = spofs.find((s) => s.nodeId === 'dynamo');
    expect(dynamoSpof).toBeUndefined();
  });

  it('should exempt serverless functions from SPOF detection', () => {
    const graph = buildGraph(
      [
        makeNode('api', NodeType.API_GATEWAY, 'api-gw'),
        makeNode('fn', NodeType.SERVERLESS, 'process-order'),
        makeNode('db', NodeType.DATABASE, 'main-rds'),
      ],
      [makeEdge('api', 'fn'), makeEdge('fn', 'db')],
    );

    const spofs = detectSPOFs(graph, DEFAULT_RESOLVER);
    const fnSpof = spofs.find((s) => s.nodeId === 'fn');
    expect(fnSpof).toBeUndefined();
  });

  it('should detect high fan-in nodes as potential SPOFs', () => {
    const nodes = [makeNode('db', NodeType.DATABASE, 'central-db')];
    const edges: ReturnType<typeof makeEdge>[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `svc-${i}`;
      nodes.push(makeNode(id, NodeType.APPLICATION, `service-${i}`));
      edges.push(makeEdge(id, 'db'));
    }

    const graph = buildGraph(nodes, edges);
    const spofs = detectSPOFs(graph, DEFAULT_RESOLVER);
    const dbSpof = spofs.find((s) => s.nodeId === 'db');
    expect(dbSpof).toBeDefined();
  });

  it('should return empty for a single isolated node', () => {
    const graph = buildGraph([makeNode('lone', NodeType.APPLICATION)], []);
    const spofs = detectSPOFs(graph, DEFAULT_RESOLVER);
    expect(spofs).toHaveLength(0);
  });
});
