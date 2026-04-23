import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CrossAccountEdge } from '@stronghold-dr/core';

import { serializeCanonicalScanJson } from '../output/canonical-json-serializer.js';
import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('graph command', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('generates HTML from latest scan', async () => {
    const cwd = createGraphWorkspace();
    process.chdir(cwd);
    const results = await createDemoResults('minimal');
    fs.writeFileSync(
      path.join(cwd, '.stronghold', 'latest-scan.json'),
      JSON.stringify(results, null, 2),
      'utf8',
    );
    const stdout = captureStdout();
    const programModule = await import('../index.js');

    await programModule.runCli(['node', 'stronghold', 'graph']);

    const htmlPath = path.join(cwd, '.stronghold', 'graph.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    expect(html).toContain('<style>');
    expect(html).toContain('<script>');
    expect(html).toContain('AWS-visible infrastructure only');
    expect(stdout.join('')).toContain(`Graph exported to ${htmlPath}`);
  });

  it('generates JSON output when --format json', async () => {
    const cwd = createGraphWorkspace();
    process.chdir(cwd);
    const results = await createDemoResults('minimal');
    fs.writeFileSync(
      path.join(cwd, '.stronghold', 'latest-scan.json'),
      JSON.stringify(results, null, 2),
      'utf8',
    );
    const outputPath = path.join(cwd, '.stronghold', 'graph.json');
    const programModule = await import('../index.js');

    await programModule.runCli([
      'node',
      'stronghold',
      'graph',
      '--format',
      'json',
      '--output',
      outputPath,
    ]);

    const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    expect(Array.isArray(parsed.nodes)).toBe(true);
    expect(Array.isArray(parsed.edges)).toBe(true);
    expect(parsed.crossAccount).toBeDefined();
    expect(Array.isArray(parsed.crossAccount.edges)).toBe(true);
  });

  it('exits 2 when no scan exists', async () => {
    const cwd = createGraphWorkspace();
    process.chdir(cwd);
    const stderr = captureStderr();
    const programModule = await import('../index.js');

    await programModule.runCli(['node', 'stronghold', 'graph']);

    expect(process.exitCode).toBe(2);
    expect(stderr.join('')).toContain('No scan found. Run `stronghold scan` first.');
  });

  it('exits 2 when format is invalid', async () => {
    const cwd = createGraphWorkspace();
    process.chdir(cwd);
    const stderr = captureStderr();
    const programModule = await import('../index.js');

    await programModule.runCli(['node', 'stronghold', 'graph', '--format', 'pdf']);

    expect(process.exitCode).toBe(2);
    expect(stderr.join('')).toContain("Invalid format: pdf. Use 'html' or 'json'.");
  });

  it('includes cross-account edges when --include-cross-account', async () => {
    const cwd = createGraphWorkspace();
    process.chdir(cwd);
    const results = await createDemoResults('minimal');
    const canonical = serializeCanonicalScanJson({
      kind: 'multi-account',
      results,
      accounts: [
        {
          accountId: '111122223333',
          alias: 'prod',
          region: 'eu-west-1',
          status: 'success',
          resourceCount: results.nodes.length,
          findingCount: results.validationReport.results.length,
          durationMs: 1_200,
        },
      ],
      errors: [],
      crossAccount: {
        edges: [buildCrossAccountEdge(results.nodes[0]?.id, results.nodes[1]?.id)],
        summary: {
          total: 1,
          byKind: { vpc_peering: 1 },
          complete: 1,
          partial: 0,
          critical: 1,
          degraded: 0,
          informational: 0,
        },
      },
      summary: {
        totalAccounts: 1,
        successfulAccounts: 1,
        failedAccounts: 0,
        totalResources: results.nodes.length,
        resourcesByAccount: {
          '111122223333': results.nodes.length,
        },
        totalFindings: results.validationReport.results.length,
        findingsByAccount: {
          '111122223333': results.validationReport.results.length,
        },
        crossAccountEdges: 1,
      },
    });
    fs.writeFileSync(
      path.join(cwd, '.stronghold', 'latest-scan.json'),
      JSON.stringify(canonical, null, 2),
      'utf8',
    );
    const programModule = await import('../index.js');

    await programModule.runCli(['node', 'stronghold', 'graph', '--include-cross-account']);

    const html = fs.readFileSync(path.join(cwd, '.stronghold', 'graph.html'), 'utf8');
    expect(html).toContain('cross-account');
    expect(html).toContain('vpc_peering');
  });
});

function createGraphWorkspace(): string {
  const cwd = createTempDirectory('stronghold-graph-command-');
  fs.mkdirSync(path.join(cwd, '.stronghold'), { recursive: true });
  return cwd;
}

function captureStdout(): string[] {
  const stdout: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  return stdout;
}

function captureStderr(): string[] {
  const stderr: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  return stderr;
}

function buildCrossAccountEdge(
  sourceArn: string | undefined,
  targetArn: string | undefined,
): CrossAccountEdge {
  if (!sourceArn || !targetArn) {
    throw new Error('Demo scenario must include at least two graph nodes.');
  }

  return {
    sourceArn,
    sourceAccountId: '111122223333',
    targetArn,
    targetAccountId: '444455556666',
    kind: 'vpc_peering',
    direction: 'bidirectional',
    drImpact: 'critical',
    completeness: 'complete',
    metadata: {
      kind: 'vpc_peering',
      peeringConnectionId: 'pcx-123',
      requesterVpcId: 'vpc-1111',
      accepterVpcId: 'vpc-2222',
      status: 'active',
    },
  };
}
