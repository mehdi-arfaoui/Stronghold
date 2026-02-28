import assert from 'node:assert/strict';
import test from 'node:test';
import Graph from 'graphology';
import { runSimulation } from '../src/graph/simulationEngine.js';

function buildGraph() {
  const graph = new (Graph as any)({
    type: 'directed',
    multi: false,
    allowSelfLoops: false,
  });

  graph.addNode('db-primary', {
    id: 'db-primary',
    name: 'payment-db',
    type: 'DATABASE',
    provider: 'aws',
    region: 'eu-west-1',
    tags: { app: 'shopmax' },
    metadata: {},
    isSPOF: true,
    financialImpactPerHour: 12000,
    suggestedRTO: 180,
    validatedRTO: 120,
    suggestedRPO: 30,
    validatedRPO: 15,
  });
  graph.addNode('obj-storage', {
    id: 'obj-storage',
    name: 'order-archive',
    type: 'OBJECT_STORAGE',
    provider: 'aws',
    region: 'eu-west-1',
    tags: { app: 'shopmax' },
    metadata: {},
    isSPOF: false,
    financialImpactPerHour: 8000,
    suggestedRTO: 240,
    validatedRTO: 180,
    suggestedRPO: 60,
    validatedRPO: 45,
  });
  graph.addNode('api-gateway', {
    id: 'api-gateway',
    name: 'api-gateway',
    type: 'APPLICATION',
    provider: 'aws',
    region: 'eu-west-1',
    tags: { app: 'shopmax' },
    metadata: {},
    isSPOF: false,
    financialImpactPerHour: 2500,
    suggestedRTO: 90,
    validatedRTO: 60,
    suggestedRPO: 30,
    validatedRPO: 15,
  });
  graph.addNode('public-dns', {
    id: 'public-dns',
    name: 'route53',
    type: 'DNS',
    provider: 'aws',
    region: 'eu-west-1',
    tags: { app: 'shopmax' },
    metadata: {},
    isSPOF: true,
    financialImpactPerHour: 900,
    suggestedRTO: 30,
    validatedRTO: 15,
    suggestedRPO: 15,
    validatedRPO: 10,
  });

  graph.addEdgeWithKey('api->db', 'api-gateway', 'db-primary', { type: 'DEPENDS_ON' });
  graph.addEdgeWithKey('api->storage', 'api-gateway', 'obj-storage', { type: 'DEPENDS_ON' });

  return graph as any;
}

function buildPropagationGraph() {
  const graph = new (Graph as any)({
    type: 'directed',
    multi: false,
    allowSelfLoops: false,
  });

  graph.addNode('db-primary', {
    id: 'db-primary',
    name: 'payment-db',
    type: 'DATABASE',
    provider: 'aws',
    region: 'eu-west-1',
    tags: { app: 'shopmax' },
    metadata: {},
    isSPOF: true,
    financialImpactPerHour: 12000,
    suggestedRTO: 180,
    validatedRTO: 120,
    suggestedRPO: 30,
    validatedRPO: 15,
  });
  graph.addNode('api-gateway', {
    id: 'api-gateway',
    name: 'api-gateway',
    type: 'APPLICATION',
    provider: 'aws',
    region: 'eu-west-1',
    tags: { app: 'shopmax' },
    metadata: {},
    isSPOF: false,
    financialImpactPerHour: 2500,
    suggestedRTO: 90,
    validatedRTO: 60,
    suggestedRPO: 30,
    validatedRPO: 15,
  });
  graph.addNode('web-frontend', {
    id: 'web-frontend',
    name: 'web-frontend',
    type: 'LOAD_BALANCER',
    provider: 'aws',
    region: 'eu-west-1',
    tags: { app: 'shopmax' },
    metadata: {},
    isSPOF: false,
    financialImpactPerHour: 1600,
    suggestedRTO: 45,
    validatedRTO: 30,
    suggestedRPO: 15,
    validatedRPO: 10,
  });

  graph.addEdgeWithKey('api->db', 'api-gateway', 'db-primary', { type: 'DEPENDS_ON' });
  graph.addEdgeWithKey('web->api', 'web-frontend', 'api-gateway', { type: 'ROUTES_TO' });

  return graph as any;
}

test('ransomware supports multi-target node types and yields non-zero financial loss', () => {
  const graph = buildGraph();

  const result = runSimulation(graph, {
    scenarioType: 'ransomware',
    params: {
      targetTypes: ['DATABASE', 'OBJECT_STORAGE'],
    },
    name: 'Ransomware data-tier',
  } as any);

  const directIds = new Set(result.directlyAffected.map((node) => node.id));
  assert.equal(directIds.has('db-primary'), true);
  assert.equal(directIds.has('obj-storage'), true);
  assert.ok(result.metrics.estimatedFinancialLoss > 0);
});

test('ransomware falls back to data-bearing nodes when targetType has no match', () => {
  const graph = buildGraph();

  const result = runSimulation(graph, {
    scenarioType: 'ransomware',
    params: {
      targetType: 'VM',
    },
    name: 'Ransomware unmatched-type fallback',
  } as any);

  const impactedIds = new Set([
    ...result.directlyAffected.map((node) => node.id),
    ...result.cascadeImpacted.map((node) => node.id),
  ]);
  assert.equal(impactedIds.has('db-primary') || impactedIds.has('obj-storage'), true);
  assert.ok(result.metrics.estimatedFinancialLoss > 0);
});

test('simulation timeline uses second-based propagation delays with causal parents', () => {
  const graph = buildPropagationGraph();

  const result = runSimulation(graph, {
    scenarioType: 'database_failure',
    params: {
      databases: ['db-primary'],
    },
    name: 'Database failure propagation',
  } as any);

  const timeline = result.warRoomData.propagationTimeline;
  assert.ok(timeline.length >= 3);

  const dbEvent = timeline.find((event) => event.nodeId === 'db-primary');
  const apiEvent = timeline.find((event) => event.nodeId === 'api-gateway');
  const frontendEvent = timeline.find((event) => event.nodeId === 'web-frontend');

  assert.ok(dbEvent);
  assert.ok(apiEvent);
  assert.ok(frontendEvent);

  assert.equal(dbEvent?.delaySeconds, 0);
  assert.equal(dbEvent?.impactType, 'initial_failure');

  assert.ok((apiEvent?.delaySeconds ?? 0) >= 3);
  assert.ok((apiEvent?.delaySeconds ?? 0) <= 15);
  assert.equal(apiEvent?.parentNodeId, 'db-primary');
  assert.equal(apiEvent?.impactType, 'direct_cascade');

  assert.ok((frontendEvent?.delaySeconds ?? 0) > (apiEvent?.delaySeconds ?? 0));
  assert.ok((frontendEvent?.delaySeconds ?? 0) <= (apiEvent?.delaySeconds ?? 0) + 30);
  assert.equal(frontendEvent?.parentNodeId, 'api-gateway');
  assert.equal(frontendEvent?.impactType, 'indirect_cascade');

  for (let index = 1; index < timeline.length; index += 1) {
    assert.ok(timeline[index]!.delaySeconds >= timeline[index - 1]!.delaySeconds);
  }
});
