import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { Graph } from 'graphology';

import type { GovernanceState } from '../../governance/index.js';
import { analyzeBuiltInScenarios } from '../../scenarios/index.js';
import { buildServicePosture } from '../../services/index.js';
import { getStartupDemoPipelineInput } from '../../demo/startup-demo.js';
import { analyzeFullGraph, cloneGraph } from '../../graph/index.js';
import { generateDRPlan } from '../../drp/index.js';
import { allValidationRules, runValidation } from '../../validation/index.js';
import { FileHistoryStore, buildScanSnapshot } from '../index.js';

describe('FileHistoryStore', () => {
  it('appends snapshots to the store', async () => {
    const filePath = path.join(createTempDirectory('stronghold-history-'), '.stronghold', 'history.jsonl');
    const store = new FileHistoryStore(filePath);

    await store.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z'));
    await store.addSnapshot(createSnapshot('scan-2', '2026-04-02T00:00:00.000Z'));

    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"id":"scan-1"');
    expect(lines[1]).toContain('"id":"scan-2"');
  });

  it('returns the most recent and previous snapshots', async () => {
    const filePath = path.join(createTempDirectory('stronghold-history-'), '.stronghold', 'history.jsonl');
    const store = new FileHistoryStore(filePath);

    await store.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z'));
    await store.addSnapshot(createSnapshot('scan-2', '2026-04-02T00:00:00.000Z'));
    await store.addSnapshot(createSnapshot('scan-3', '2026-04-03T00:00:00.000Z'));

    expect((await store.getLatest())?.id).toBe('scan-3');
    expect((await store.getPrevious())?.id).toBe('scan-2');
  });

  it('returns null for an empty store', async () => {
    const filePath = path.join(createTempDirectory('stronghold-history-'), '.stronghold', 'history.jsonl');
    const store = new FileHistoryStore(filePath);

    expect(await store.getLatest()).toBeNull();
    expect(await store.getPrevious()).toBeNull();
  });

  it('filters snapshots by since and until', async () => {
    const filePath = path.join(createTempDirectory('stronghold-history-'), '.stronghold', 'history.jsonl');
    const store = new FileHistoryStore(filePath);

    await store.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z'));
    await store.addSnapshot(createSnapshot('scan-2', '2026-04-05T00:00:00.000Z'));
    await store.addSnapshot(createSnapshot('scan-3', '2026-04-08T00:00:00.000Z'));

    const filtered = await store.getSnapshots({
      since: '2026-04-02T00:00:00.000Z',
      until: '2026-04-07T23:59:59.999Z',
    });

    expect(filtered.map((snapshot) => snapshot.id)).toEqual(['scan-2']);
  });

  it('keeps only the latest 50 snapshots', async () => {
    const filePath = path.join(createTempDirectory('stronghold-history-'), '.stronghold', 'history.jsonl');
    const store = new FileHistoryStore(filePath);

    for (let index = 1; index <= 51; index += 1) {
      await store.addSnapshot(
        createSnapshot(
          `scan-${index}`,
          `2026-04-${String(Math.min(index, 30)).padStart(2, '0')}T00:00:00.000Z`,
        ),
      );
    }

    const snapshots = await store.getSnapshots();

    expect(snapshots).toHaveLength(50);
    expect(snapshots[0]?.id).toBe('scan-2');
    expect(snapshots.at(-1)?.id).toBe('scan-51');
  });

  it('builds compact snapshots instead of storing full scan payloads', async () => {
    const snapshot = await createRealisticSnapshot();
    const serialized = JSON.stringify(snapshot);

    expect(serialized.length).toBeLessThan(10_000);
    expect(serialized).not.toContain('"nodes"');
    expect(serialized).not.toContain('"validationReport"');
  });

  it('captures governance metrics in snapshots', async () => {
    const snapshot = await createRealisticSnapshot({
      riskAcceptances: [
        {
          id: 'ra-001',
          findingKey: 'backup_plan_exists::payment-db',
          acceptedBy: 'mehdi@example.com',
          justification: 'Approved for staging',
          acceptedAt: '2026-03-01T00:00:00Z',
          expiresAt: '2026-09-01T00:00:00Z',
          severityAtAcceptance: 'high',
          status: 'active',
        },
      ],
      score: {
        withAcceptances: { score: 80, grade: 'B' },
        withoutAcceptances: { score: 70, grade: 'C' },
        excludedFindings: 1,
      },
      policyViolations: [
        {
          policyId: 'pol-001',
          policyName: 'Critical services must have backup',
          findingKey: 'backup_plan_exists::payment-db',
          nodeId: 'payment-db',
          serviceId: 'payment',
          severity: 'critical',
          message: 'payment-db violates policy "Critical services must have backup".',
        },
      ],
    });

    expect(snapshot.governance).toEqual({
      ownerCoverage: 0,
      activeAcceptances: 1,
      expiredAcceptances: 0,
      policyViolations: 1,
    });
  });
});

function createSnapshot(id: string, timestamp: string) {
  return {
    id,
    timestamp,
    globalScore: 68,
    globalGrade: 'C',
    proofOfRecovery: 33,
    observedCoverage: 67,
    totalResources: 42,
    totalFindings: 5,
    findingsBySeverity: {
      critical: 2,
      high: 2,
      medium: 1,
      low: 0,
    },
    services: [
      {
        serviceId: 'payment',
        serviceName: 'Payment',
        score: 34,
        grade: 'D' as const,
        findingCount: 3,
        criticalFindingCount: 1,
        resourceCount: 6,
      },
    ],
    scenarioCoverage: {
      total: 8,
      covered: 2,
      partiallyCovered: 1,
      uncovered: 5,
    },
    evidenceDistribution: {
      observed: 20,
      inferred: 1,
      declared: 0,
      tested: 3,
      expired: 1,
    },
    findingIds: ['backup_plan_exists::payment-db'],
    regions: ['eu-west-1'],
    scanDurationMs: 14_200,
    scannerSuccessCount: 8,
    scannerFailureCount: 1,
  };
}

async function createRealisticSnapshot(governance?: GovernanceState) {
  const demo = getStartupDemoPipelineInput();
  const graph = new Graph();
  demo.nodes.forEach((node) => {
    graph.addNode(node.id, node);
  });
  demo.edges.forEach((edge, index) => {
    graph.addDirectedEdgeWithKey(`${edge.source}:${edge.target}:${edge.type}:${index}`, edge.source, edge.target, edge);
  });

  const analysis = await analyzeFullGraph(graph);
  const validationReport = runValidation(demo.nodes, demo.edges, allValidationRules, undefined, {
    timestamp: '2026-04-08T00:00:00.000Z',
  });
  const drpPlan = generateDRPlan({
    graph: cloneGraph(graph),
    analysis,
    provider: demo.provider,
    generatedAt: new Date('2026-04-08T00:00:00.000Z'),
  });
  const servicePosture = buildServicePosture({
    nodes: demo.nodes,
    edges: demo.edges,
    validationReport,
    recommendations: [],
  });
  const scenarioAnalysis = analyzeBuiltInScenarios({
    graph: cloneGraph(graph),
    nodes: demo.nodes,
    services: servicePosture.detection.services,
    analysis,
    drp: drpPlan,
    evidence: [],
  });

  return buildScanSnapshot({
    scanId: 'scan-demo',
    timestamp: '2026-04-08T00:00:00.000Z',
    validationReport,
    totalResources: demo.nodes.length,
    regions: demo.regions,
    servicePosture,
    ...(governance ? { governance } : {}),
    scenarioAnalysis,
    scanDurationMs: 14_200,
    scannerSuccessCount: 8,
    scannerFailureCount: 1,
  });
}

function createTempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
