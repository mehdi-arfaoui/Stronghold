import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileEvidenceStore, type Evidence, type ServicePosture } from '@stronghold-dr/core';

import {
  addEvidenceEntry,
  renderEvidenceDetail,
  renderEvidenceList,
  resolveServiceIdForNode,
} from '../commands/evidence.js';
import { renderStatusSnapshot } from '../commands/status.js';
import { createTempDirectory } from './test-utils.js';

describe('evidence command helpers', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.resetModules();
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

describe('evidence add with RTO/RPO', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('adds evidence with --rto 45m --rpo 2m', async () => {
    const cwd = createTempDirectory('stronghold-evidence-rto-');

    await runCliIn(cwd, [
      'evidence',
      'add',
      '--service',
      'database',
      '--type',
      'tested',
      '--scenario',
      'region_failure',
      '--rto',
      '45m',
      '--rpo',
      '2m',
      '--description',
      'Game day Q2 2026',
    ]);

    const evidence = readEvidence(cwd)[0];
    expect(evidence?.type).toBe('tested');
    expect(evidence?.subject.serviceId).toBe('database');
    expect(evidence?.scenario).toBe('region_failure');
    expect(evidence?.measuredRTO).toBe(45);
    expect(evidence?.measuredRPO).toBe(2);
    expect(process.exitCode).toBeUndefined();
  });

  it('rejects --rto abc', async () => {
    const output = await runCliIn(createTempDirectory('stronghold-evidence-rto-'), [
      'evidence',
      'add',
      '--service',
      'database',
      '--type',
      'tested',
      '--rto',
      'abc',
    ]);

    expect(process.exitCode).toBe(2);
    expect(output.stderr).toContain('--rto must be a positive duration');
  });

  it('rejects --rto 0m', async () => {
    const output = await runCliIn(createTempDirectory('stronghold-evidence-rto-'), [
      'evidence',
      'add',
      '--service',
      'database',
      '--type',
      'tested',
      '--rto',
      '0m',
    ]);

    expect(process.exitCode).toBe(2);
    expect(output.stderr).toContain('--rto must be a positive duration');
  });

  it('rejects --rto with --type observed', async () => {
    const output = await runCliIn(createTempDirectory('stronghold-evidence-rto-'), [
      'evidence',
      'add',
      '--service',
      'database',
      '--type',
      'observed',
      '--rto',
      '45m',
    ]);

    expect(process.exitCode).toBe(2);
    expect(output.stderr).toContain('measured RTO/RPO requires --type tested');
  });

  it('works without --rto/--rpo for backward compatibility', async () => {
    const cwd = createTempDirectory('stronghold-evidence-rto-');

    await runCliIn(cwd, [
      'evidence',
      'add',
      '--node',
      'payment-db',
      '--type',
      'restore-test',
      '--result',
      'success',
    ]);

    const evidence = readEvidence(cwd)[0];
    expect(evidence?.type).toBe('tested');
    expect(evidence?.source.origin).toBe('test');
    if (evidence?.source.origin === 'test') {
      expect(evidence.source.testType).toBe('restore-test');
    }
    expect(evidence?.measuredRTO).toBeUndefined();
  });

  it('stores scenario when --scenario provided', async () => {
    const cwd = createTempDirectory('stronghold-evidence-rto-');

    await runCliIn(cwd, [
      'evidence',
      'add',
      '--service',
      'database',
      '--type',
      'tested',
      '--scenario',
      'region_failure',
    ]);

    const evidence = readEvidence(cwd)[0];
    expect(evidence?.scenario).toBe('region_failure');
    expect(evidence?.observation.key).toBe('scenario');
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

async function runCliIn(
  cwd: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  process.chdir(cwd);
  process.exitCode = undefined;
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });

  const programModule = await import('../index.js');
  await programModule.runCli(['node', 'stronghold', ...args]);

  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
  };
}

function readEvidence(cwd: string): readonly Evidence[] {
  const contents = fs.readFileSync(path.join(cwd, '.stronghold', 'evidence.jsonl'), 'utf8');
  return contents
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Evidence);
}
