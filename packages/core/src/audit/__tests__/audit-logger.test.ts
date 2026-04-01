import fs from 'node:fs';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileAuditLogger } from '../audit-logger.js';
import type { AuditEntry } from '../audit-types.js';

describe('FileAuditLogger', () => {
  it('creates the directory and file when they do not exist', async () => {
    const directory = createTempDirectory('stronghold-audit-');
    const auditPath = path.join(directory, '.stronghold', 'audit.jsonl');
    const logger = new FileAuditLogger(auditPath);

    await logger.log(createAuditEntry());

    const contents = await readFile(auditPath, 'utf8');
    expect(contents).toContain('"action":"scan"');
  });

  it('writes valid JSON Lines output', async () => {
    const directory = createTempDirectory('stronghold-audit-');
    const auditPath = path.join(directory, '.stronghold', 'audit.jsonl');
    const logger = new FileAuditLogger(auditPath);

    await logger.log(createAuditEntry());

    const [line] = (await readFile(auditPath, 'utf8')).trim().split('\n');
    expect(() => JSON.parse(line ?? '')).not.toThrow();
  });

  it('appends entries without truncating existing content', async () => {
    const directory = createTempDirectory('stronghold-audit-');
    const auditPath = path.join(directory, '.stronghold', 'audit.jsonl');
    const logger = new FileAuditLogger(auditPath);

    await logger.log(createAuditEntry({ action: 'scan' }));
    await logger.log(createAuditEntry({ action: 'report' }));
    await logger.log(createAuditEntry({ action: 'plan_generate' }));

    const lines = (await readFile(auditPath, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('allows entries without an identity block', async () => {
    const directory = createTempDirectory('stronghold-audit-');
    const auditPath = path.join(directory, '.stronghold', 'audit.jsonl');
    const logger = new FileAuditLogger(auditPath);

    await logger.log(createAuditEntry({ identity: undefined }));

    const [line] = (await readFile(auditPath, 'utf8')).trim().split('\n');
    expect(JSON.parse(line ?? '')).not.toHaveProperty('identity');
  });

  it('writes only audit metadata fields and not infrastructure payloads', async () => {
    const directory = createTempDirectory('stronghold-audit-');
    const auditPath = path.join(directory, '.stronghold', 'audit.jsonl');
    const logger = new FileAuditLogger(auditPath);

    await logger.log(
      {
        ...createAuditEntry(),
        parameters: {
          regions: ['eu-west-1'],
          flags: ['--encrypt'],
        },
      } as AuditEntry,
    );

    const [line] = (await readFile(auditPath, 'utf8')).trim().split('\n');
    const parsed = JSON.parse(line ?? '') as Record<string, unknown>;

    expect(parsed).not.toHaveProperty('nodes');
    expect(parsed).not.toHaveProperty('data');
    expect(parsed).not.toHaveProperty('validationReport');
  });
});

function createAuditEntry(
  overrides: Partial<AuditEntry> = {},
): AuditEntry {
  return {
    timestamp: '2026-03-27T15:00:00.000Z',
    version: '0.1.0',
    action: 'scan',
    identity: {
      arn: 'arn:aws:sts::123456789012:assumed-role/Stronghold/test-user',
      accountId: '123456789012',
      userId: 'AIDATEST',
    },
    parameters: {
      regions: ['eu-west-1'],
      services: ['rds'],
      outputFormat: 'json',
      flags: ['--encrypt'],
    },
    result: {
      status: 'success',
      duration_ms: 1234,
      resourceCount: 42,
    },
    ...overrides,
  };
}

function createTempDirectory(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
