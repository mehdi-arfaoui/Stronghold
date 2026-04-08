import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileHistoryStore } from '../history-store.js';
import { FileFindingLifecycleStore, trackFindings } from '../finding-tracker.js';
import type { TrackedFinding } from '../finding-lifecycle-types.js';

describe('trackFindings', () => {
  it('marks all findings as new on the first scan', async () => {
    const { historyStore, lifecycleStore } = createStores();
    await historyStore.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z', ['rule-a::node-1']));

    const delta = await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-01T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1', 'payment', 'Payment')]),
    });

    expect(delta.summary).toEqual({
      newCount: 1,
      resolvedCount: 0,
      recurrentCount: 0,
      persistentCount: 0,
    });
    expect(delta.newFindings[0]?.serviceId).toBe('payment');
  });

  it('detects new and persistent findings between scans', async () => {
    const { historyStore, lifecycleStore } = createStores();

    await historyStore.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z', ['rule-a::node-1']));
    await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-01T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1')]),
    });

    await historyStore.addSnapshot(
      createSnapshot('scan-2', '2026-04-08T00:00:00.000Z', ['rule-a::node-1', 'rule-b::node-2']),
    );
    const delta = await trackFindings(['rule-a::node-1', 'rule-b::node-2'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-08T00:00:00.000Z',
      findingContextByKey: createFindingMap([
        trackedFinding('rule-a::node-1'),
        trackedFinding('rule-b::node-2', 'auth', 'Auth'),
      ]),
    });

    expect(delta.summary.newCount).toBe(1);
    expect(delta.summary.persistentCount).toBe(1);
    expect(delta.newFindings[0]?.findingKey).toBe('rule-b::node-2');
    expect(delta.persistentFindings[0]?.ageInDays).toBe(7);
  });

  it('detects resolved findings', async () => {
    const { historyStore, lifecycleStore } = createStores();

    await historyStore.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z', ['rule-a::node-1']));
    await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-01T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1', 'payment', 'Payment')]),
    });

    await historyStore.addSnapshot(createSnapshot('scan-2', '2026-04-08T00:00:00.000Z', []));
    const delta = await trackFindings([], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-08T00:00:00.000Z',
    });

    expect(delta.summary.resolvedCount).toBe(1);
    expect(delta.resolvedFindings[0]?.status).toBe('resolved');
    expect(delta.resolvedFindings[0]?.resolvedAt).toBe('2026-04-08T00:00:00.000Z');
    expect(delta.resolvedFindings[0]?.serviceId).toBe('payment');
  });

  it('detects recurrent findings and increments recurrence count on each return', async () => {
    const { historyStore, lifecycleStore } = createStores();

    await historyStore.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z', ['rule-a::node-1']));
    await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-01T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1')]),
    });

    await historyStore.addSnapshot(createSnapshot('scan-2', '2026-04-08T00:00:00.000Z', []));
    await trackFindings([], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-08T00:00:00.000Z',
    });

    await historyStore.addSnapshot(createSnapshot('scan-3', '2026-04-15T00:00:00.000Z', ['rule-a::node-1']));
    const firstRecurrence = await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-15T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1')]),
    });

    expect(firstRecurrence.summary.recurrentCount).toBe(1);
    expect(firstRecurrence.recurrentFindings[0]?.recurrenceCount).toBe(1);

    await historyStore.addSnapshot(createSnapshot('scan-4', '2026-04-22T00:00:00.000Z', []));
    await trackFindings([], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-22T00:00:00.000Z',
    });

    await historyStore.addSnapshot(createSnapshot('scan-5', '2026-04-29T00:00:00.000Z', ['rule-a::node-1']));
    const secondRecurrence = await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-29T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1')]),
    });

    expect(secondRecurrence.recurrentFindings[0]?.recurrenceCount).toBe(2);
  });

  it('updates persisted active findings in the lifecycle store', async () => {
    const { historyStore, lifecycleStore } = createStores();

    await historyStore.addSnapshot(createSnapshot('scan-1', '2026-04-01T00:00:00.000Z', ['rule-a::node-1']));
    await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-01T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1', 'payment', 'Payment')]),
    });

    await historyStore.addSnapshot(createSnapshot('scan-2', '2026-04-10T00:00:00.000Z', ['rule-a::node-1']));
    await trackFindings(['rule-a::node-1'], historyStore, {
      lifecycleStore,
      currentTimestamp: '2026-04-10T00:00:00.000Z',
      findingContextByKey: createFindingMap([trackedFinding('rule-a::node-1', 'payment', 'Payment')]),
    });

    const persisted = await lifecycleStore.getByKey('rule-a::node-1', '2026-04-10T00:00:00.000Z');

    expect(persisted?.lastSeenAt).toBe('2026-04-10T00:00:00.000Z');
    expect(persisted?.ageInDays).toBe(9);
    expect(persisted?.serviceName).toBe('Payment');
  });
});

function createStores() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-finding-tracker-'));
  return {
    historyStore: new FileHistoryStore(path.join(directory, '.stronghold', 'history.jsonl')),
    lifecycleStore: new FileFindingLifecycleStore(
      path.join(directory, '.stronghold', 'finding-lifecycles.json'),
    ),
  };
}

function createSnapshot(id: string, timestamp: string, findingIds: readonly string[]) {
  return {
    id,
    timestamp,
    globalScore: 68,
    globalGrade: 'C',
    totalResources: 42,
    totalFindings: findingIds.length,
    findingsBySeverity: {
      critical: findingIds.length,
      high: 0,
      medium: 0,
      low: 0,
    },
    services: [],
    scenarioCoverage: {
      total: 8,
      covered: 2,
      partiallyCovered: 1,
      uncovered: 5,
    },
    evidenceDistribution: {
      observed: 20,
      inferred: 0,
      declared: 0,
      tested: 1,
      expired: 0,
    },
    findingIds,
    regions: ['eu-west-1'],
    scanDurationMs: 12_000,
    scannerSuccessCount: 4,
    scannerFailureCount: 0,
  };
}

function trackedFinding(
  findingKey: string,
  serviceId?: string,
  serviceName?: string,
): TrackedFinding {
  const [ruleId, nodeId] = findingKey.split('::');
  return {
    findingKey,
    ruleId: ruleId ?? findingKey,
    nodeId: nodeId ?? findingKey,
    severity: 'critical',
    ...(serviceId ? { serviceId, serviceName } : {}),
  };
}

function createFindingMap(findings: readonly TrackedFinding[]): ReadonlyMap<string, TrackedFinding> {
  return new Map(findings.map((finding) => [finding.findingKey, finding] as const));
}
