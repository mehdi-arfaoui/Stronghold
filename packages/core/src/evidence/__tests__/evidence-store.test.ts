import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileEvidenceStore } from '../evidence-store.js';
import type { Evidence } from '../evidence-types.js';

describe('FileEvidenceStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends evidence entries in jsonl format', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-evidence-store-'));
    const filePath = path.join(directory, '.stronghold', 'evidence.jsonl');
    const store = new FileEvidenceStore(filePath);

    await store.add(createEvidence('evidence-1', { nodeId: 'payment-db' }));
    await store.add(createEvidence('evidence-2', { nodeId: 'payment-db' }));

    const lines = fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"id":"evidence-1"');
    expect(lines[1]).toContain('"id":"evidence-2"');
  });

  it('filters evidence by node and service', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-evidence-store-'));
    const filePath = path.join(directory, '.stronghold', 'evidence.jsonl');
    const store = new FileEvidenceStore(filePath);

    await store.add(createEvidence('evidence-1', { nodeId: 'payment-db', serviceId: 'payment' }));
    await store.add(createEvidence('evidence-2', { nodeId: 'auth-db', serviceId: 'auth' }));

    expect(await store.getByNode('payment-db')).toHaveLength(1);
    expect(await store.getByService('auth')).toHaveLength(1);
  });

  it('materializes expired evidence without deleting it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-evidence-store-'));
    const filePath = path.join(directory, '.stronghold', 'evidence.jsonl');
    const store = new FileEvidenceStore(filePath);

    await store.add(
      createEvidence('evidence-1', {
        nodeId: 'payment-db',
        expiresAt: '2026-04-01T00:00:00.000Z',
      }),
    );

    const all = await store.getAll();
    const expired = await store.getExpired();

    expect(all[0]?.type).toBe('expired');
    expect(expired).toHaveLength(1);
    expect(fs.readFileSync(filePath, 'utf8')).toContain('"type":"tested"');
  });
});

function createEvidence(
  id: string,
  options: {
    readonly nodeId: string;
    readonly serviceId?: string;
    readonly expiresAt?: string;
  },
): Evidence {
  return {
    id,
    type: 'tested',
    source: {
      origin: 'test',
      testType: 'restore-test',
      testDate: '2026-03-01T00:00:00.000Z',
    },
    subject: {
      nodeId: options.nodeId,
      ...(options.serviceId ? { serviceId: options.serviceId } : {}),
    },
    observation: {
      key: 'restore-test',
      value: 'success',
      expected: 'success',
      description: 'Manual restore-test recorded as success.',
    },
    timestamp: '2026-03-01T00:00:00.000Z',
    ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
    testResult: {
      status: 'success',
      duration: '12 minutes',
      executor: 'team-backend',
    },
  };
}
