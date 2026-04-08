import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileEvidenceStore, type ServicePosture } from '@stronghold-dr/core';

import {
  addEvidenceEntry,
  renderEvidenceDetail,
  renderEvidenceList,
  resolveServiceIdForNode,
} from '../commands/evidence.js';
import { renderStatusSnapshot } from '../commands/status.js';

describe('evidence command helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('writes a tested evidence entry with the default 90-day expiration', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-evidence-cli-'));
    const store = new FileEvidenceStore(path.join(directory, '.stronghold', 'evidence.jsonl'));

    const evidence = await addEvidenceEntry({
      store,
      nodeId: 'payment-db',
      serviceId: 'payment',
      testType: 'restore-test',
      result: 'success',
      duration: '12 minutes',
      notes: 'Full restore from snapshot, data verified',
      executor: 'team-backend',
      now: new Date('2026-04-08T00:00:00.000Z'),
    });

    expect(evidence.type).toBe('tested');
    expect(evidence.expiresAt).toBe('2026-07-07T00:00:00.000Z');
    expect((await store.getAll())).toHaveLength(1);
  });

  it('supports custom expiration values', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-evidence-cli-'));
    const store = new FileEvidenceStore(path.join(directory, '.stronghold', 'evidence.jsonl'));

    const evidence = await addEvidenceEntry({
      store,
      nodeId: 'payment-db',
      testType: 'restore-test',
      result: 'success',
      executor: 'team-backend',
      expiresInDays: 14,
      now: new Date('2026-04-08T00:00:00.000Z'),
    });

    expect(evidence.expiresAt).toBe('2026-04-22T00:00:00.000Z');
  });

  it('renders list output and flags expired evidence', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));

    const rendered = renderEvidenceList([
      {
        id: 'evidence-1',
        type: 'tested',
        source: { origin: 'test', testType: 'restore-test', testDate: '2026-03-15T00:00:00.000Z' },
        subject: { nodeId: 'payment-db', serviceId: 'payment' },
        observation: {
          key: 'restore-test',
          value: 'success',
          expected: 'success',
          description: 'Manual restore-test recorded as success.',
        },
        timestamp: '2026-03-15T00:00:00.000Z',
        expiresAt: '2026-01-15T00:00:00.000Z',
        testResult: { status: 'partial', duration: '45 min', executor: 'team-backend' },
      },
    ]);

    expect(rendered).toContain('Evidence (1):');
    expect(rendered).toContain('EXPIRED (2026-01-15)');
  });

  it('renders detailed evidence notes', () => {
    const rendered = renderEvidenceDetail({
      id: 'evidence-1',
      type: 'tested',
      source: { origin: 'test', testType: 'restore-test', testDate: '2026-03-15T00:00:00.000Z' },
      subject: { nodeId: 'payment-db', serviceId: 'payment' },
      observation: {
        key: 'restore-test',
        value: 'success',
        expected: 'success',
        description: 'Manual restore-test recorded as success.',
      },
      timestamp: '2026-03-15T00:00:00.000Z',
      expiresAt: '2026-07-07T00:00:00.000Z',
      testResult: {
        status: 'success',
        duration: '15 min',
        executor: 'team-backend',
        notes: 'Manual snapshot restore test',
      },
    });

    expect(rendered).toContain('Notes: Manual snapshot restore test');
    expect(rendered).toContain('Executor: team-backend');
  });

  it('resolves a service id from services.yml without requiring a scan', async () => {
    const previousCwd = process.cwd();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-evidence-cli-'));

    try {
      process.chdir(directory);
      fs.mkdirSync(path.join(directory, '.stronghold'), { recursive: true });
      fs.writeFileSync(
        path.join(directory, '.stronghold', 'services.yml'),
        `version: 1

services:
  payment:
    name: Payment
    criticality: critical
    resources:
      - payment-db
`,
        'utf8',
      );

      expect(await resolveServiceIdForNode('payment-db')).toBe('payment');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('shows evidence alerts in the status snapshot', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-08T00:00:00.000Z'));

    const snapshot = renderStatusSnapshot(
      {
        timestamp: '2026-04-08T00:00:00.000Z',
        validationReport: {
          scoreBreakdown: {
            overall: 8,
            grade: 'F',
          },
        },
        servicePosture: createStatusPosture(),
      } as Parameters<typeof renderStatusSnapshot>[0],
      path.join(os.tmpdir(), 'missing-audit.jsonl'),
      [
        {
          id: 'evidence-1',
          type: 'tested',
          source: { origin: 'test', testType: 'restore-test', testDate: '2026-03-15T00:00:00.000Z' },
          subject: { nodeId: 'payment-db', serviceId: 'payment' },
          observation: {
            key: 'restore-test',
            value: 'success',
            expected: 'success',
            description: 'Manual restore-test recorded as success.',
          },
          timestamp: '2026-03-15T00:00:00.000Z',
          expiresAt: '2026-04-20T00:00:00.000Z',
          testResult: { status: 'success', duration: '12 min', executor: 'team-backend' },
        },
      ],
    );

    expect(snapshot).toContain('Evidence alerts:');
    expect(snapshot).toContain('restore-test expires in 12 days');
  });
});

function createStatusPosture(): ServicePosture {
  return {
    detection: {
      services: [
        {
          id: 'payment',
          name: 'Payment',
          criticality: 'critical',
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
          resources: [
            {
              nodeId: 'payment-db',
              detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
            },
          ],
          metadata: {},
        },
      ],
      unassignedResources: [],
      detectionSummary: {
        cloudformation: 0,
        tag: 0,
        topology: 0,
        manual: 1,
        totalResources: 1,
        assignedResources: 1,
        unassignedResources: 0,
      },
    },
    scoring: {
      services: [
        {
          serviceId: 'payment',
          serviceName: 'Payment',
          resourceCount: 1,
          criticality: 'critical',
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
          score: 8,
          grade: 'F',
          findingsCount: {
            critical: 2,
            high: 0,
            medium: 0,
            low: 0,
          },
          findings: [],
          coverageGaps: [],
        },
      ],
      unassigned: null,
    },
    contextualFindings: [],
    recommendations: [],
    services: [
      {
        service: {
          id: 'payment',
          name: 'Payment',
          criticality: 'critical',
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
          resources: [
            {
              nodeId: 'payment-db',
              detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
            },
          ],
          metadata: {},
        },
        score: {
          serviceId: 'payment',
          serviceName: 'Payment',
          resourceCount: 1,
          criticality: 'critical',
          detectionSource: { type: 'manual', file: '.stronghold/services.yml', confidence: 1.0 },
          score: 8,
          grade: 'F',
          findingsCount: {
            critical: 2,
            high: 0,
            medium: 0,
            low: 0,
          },
          findings: [],
          coverageGaps: [],
        },
        contextualFindings: [],
        recommendations: [],
      },
    ],
    unassigned: {
      score: null,
      resourceCount: 0,
      contextualFindings: [],
      recommendations: [],
    },
  };
}
