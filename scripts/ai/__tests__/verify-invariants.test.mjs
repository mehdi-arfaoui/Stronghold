import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { findInvariantViolations, renderInvariantReport } from '../verify-invariants.mjs';

describe('verify-invariants', () => {
  it('flags estimated RTO/RPO tokens, graph scenario engines, and fallback values in contract-sensitive code', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-invariants-'));
    const contractDir = path.join(root, 'packages/core/src/contracts');
    fs.mkdirSync(contractDir, { recursive: true });
    fs.writeFileSync(
      path.join(contractDir, 'bad-contract.ts'),
      [
        'export function bad(input) {',
        '  const a = input.estimatedRTO;',
        '  const b = input.suggestedRTO;',
        '  const c = input.validatedRTO;',
        '  const d = input.estimatedRPO;',
        '  const e = input.suggestedRPO;',
        '  const engine = "../graph/graph-scenario-engine.js";',
        '  const fallbackRto = input.rto ?? 120;',
        '  const defaultRpo = input.rpo || 60;',
        '  const unknownRto = input.unknown ?? 30;',
        '  return a ?? b ?? c ?? d ?? e ?? engine ?? fallbackRto ?? defaultRpo ?? unknownRto;',
        '}',
      ].join('\n'),
    );

    const result = findInvariantViolations({ root });
    const matches = result.violations.map((violation) => violation.match);

    expect(matches).toEqual(
      expect.arrayContaining([
        'estimatedRTO',
        'suggestedRTO',
        'validatedRTO',
        'estimatedRPO',
        'suggestedRPO',
        'graph-scenario-engine',
        '120',
        '60',
        '30',
      ]),
    );
    expect(renderInvariantReport(result)).toContain('AI invariant check: FAIL');
    expect(renderInvariantReport(result)).toContain('bad-contract.ts');
  });

  it('does not flag measured tested evidence fields', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-invariants-'));
    const contractDir = path.join(root, 'packages/core/src/contracts');
    fs.mkdirSync(contractDir, { recursive: true });
    fs.writeFileSync(
      path.join(contractDir, 'good-contract.ts'),
      [
        'export function good(evidence) {',
        '  return evidence.type === "tested" && evidence.measuredRTO <= 45;',
        '}',
      ].join('\n'),
    );

    const result = findInvariantViolations({ root });

    expect(result.violations).toEqual([]);
    expect(renderInvariantReport(result)).toContain('AI invariant check: PASS');
  });

  it('flags graph scenario engine references in contract-sensitive code', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-invariants-'));
    const contractDir = path.join(root, 'packages/core/src/contracts');
    fs.mkdirSync(contractDir, { recursive: true });
    fs.writeFileSync(
      path.join(contractDir, 'graph-contract.ts'),
      'import "../graph/graph-scenario-engine.js";\n',
    );

    const result = findInvariantViolations({ root });

    expect(result.violations.map((violation) => violation.rule)).toContain(
      'contract-graph-scenario-engine',
    );
  });

  it('flags forbidden network imports and clients in pure domain modules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-invariants-'));
    const domainDir = path.join(root, 'packages/core/src/scenarios');
    fs.mkdirSync(domainDir, { recursive: true });
    fs.writeFileSync(
      path.join(domainDir, 'bad-scenario.ts'),
      [
        "import { request } from 'node:http';",
        "import { S3Client } from '@aws-sdk/client-s3';",
        '',
        'export async function bad() {',
        "  await fetch('https://example.com');",
        '  const hook = new WebhookClient();',
        '  return new S3Client({});',
        '}',
      ].join('\n'),
    );

    const result = findInvariantViolations({ root });
    const purityViolations = result.violations.filter(
      (violation) => violation.rule === 'pure-domain-network-side-effect',
    );

    expect(purityViolations.map((violation) => violation.match)).toEqual(
      expect.arrayContaining([
        'node:http',
        '@aws-sdk/client-s3',
        'fetch',
        'WebhookClient',
        'S3Client',
      ]),
    );
    expect(renderInvariantReport(result)).toContain('bad-scenario.ts');
  });

  it('scans ordinary core directories by default for network side effects', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-invariants-'));
    const auditDir = path.join(root, 'packages/core/src/audit');
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(
      path.join(auditDir, 'bad-audit.ts'),
      [
        "import { request } from 'node:http';",
        "import { S3Client } from '@aws-sdk/client-s3';",
        "import { IncomingWebhook } from '@slack/webhook';",
        '',
        'export async function badAudit() {',
        "  await fetch('https://example.com');",
        '  request;',
        '  return [new S3Client({}), new IncomingWebhook("https://example.com")];',
        '}',
      ].join('\n'),
    );

    const result = findInvariantViolations({ root });
    const purityViolations = result.violations.filter(
      (violation) => violation.rule === 'pure-domain-network-side-effect',
    );

    expect(purityViolations.map((violation) => violation.match)).toEqual(
      expect.arrayContaining([
        'node:http',
        '@aws-sdk/client-s3',
        '@slack/webhook',
        'fetch',
        'S3Client',
        'IncomingWebhook',
      ]),
    );
    expect(renderInvariantReport(result)).toContain('packages/core/src/audit/bad-audit.ts');
  });

  it('does not scan provider adapters as pure domain modules', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-invariants-'));
    const providerDir = path.join(root, 'packages/core/src/providers/aws');
    fs.mkdirSync(providerDir, { recursive: true });
    fs.writeFileSync(
      path.join(providerDir, 'aws-scanner.ts'),
      [
        "import { S3Client } from '@aws-sdk/client-s3';",
        '',
        'export function createClient() {',
        '  return new S3Client({});',
        '}',
      ].join('\n'),
    );

    const result = findInvariantViolations({ root });

    expect(result.violations).toEqual([]);
  });
});
