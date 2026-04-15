import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../index.js';
import { saveScanResults } from '../storage/file-store.js';
import { resolveStrongholdPaths } from '../storage/paths.js';
import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('explain command', () => {
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('prints the reasoning chain with the reality gap near the top', async () => {
    const { serviceId } = await seedDemoScan('startup');
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    await runCli(['node', 'stronghold', 'explain', serviceId]);

    const output = writes.join('');
    expect(output).toContain('Reality Gap:');
    expect(output).toContain('Reasoning');
    expect(output).toContain('Recovery Chain');
    expect(output).toContain('Conclusion');
    expect(output.indexOf('Reality Gap:')).toBeLessThan(output.indexOf('Reasoning'));
    expect(output.indexOf('Recovery Chain')).toBeLessThan(output.indexOf('Conclusion'));
  });

  it('supports --verbose and shows confidence/source metadata', async () => {
    const { serviceId } = await seedDemoScan('startup');
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    await runCli(['node', 'stronghold', 'explain', serviceId, '--verbose']);

    expect(writes.join('')).toContain('source:');
  });

  it('supports --json and returns the chain payload', async () => {
    const { serviceId } = await seedDemoScan('startup');
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    await runCli(['node', 'stronghold', 'explain', serviceId, '--json']);

    const parsed = JSON.parse(writes.join(''));
    expect(parsed.chain.serviceId).toBe(serviceId);
    expect(Array.isArray(parsed.chain.insights)).toBe(true);
    expect(parsed.chain.recoveryChain).not.toBeNull();
    expect(Array.isArray(parsed.chain.recoveryChain.steps)).toBe(true);
  });

  it('supports --redact and masks infrastructure identifiers', async () => {
    const { serviceId } = await seedDemoScan('startup', { injectArnIntoFirstNode: true });
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    await runCli(['node', 'stronghold', 'explain', serviceId, '--redact']);

    const output = writes.join('');
    expect(output).not.toContain('arn:aws:');
  });

  it('returns exit code 1 when no scan exists', async () => {
    const cwd = createTempDirectory('stronghold-explain-empty-');
    process.chdir(cwd);
    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      errors.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    await runCli(['node', 'stronghold', 'explain', 'payment']);

    expect(process.exitCode).toBe(1);
    expect(errors.join('')).toContain("No scan data. Run 'stronghold scan' or 'stronghold demo' first.");
  });

  it('returns exit code 1 when the service does not exist', async () => {
    await seedDemoScan('startup');
    const errors: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      errors.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    });

    await runCli(['node', 'stronghold', 'explain', 'does-not-exist']);

    expect(process.exitCode).toBe(1);
    expect(errors.join('')).toContain("Service 'does-not-exist' not found. Run 'stronghold services list'.");
  });

  it('writes an explain audit entry', async () => {
    const { serviceId, paths } = await seedDemoScan('startup');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await runCli(['node', 'stronghold', 'explain', serviceId]);

    const audit = fs.readFileSync(paths.auditLogPath, 'utf8');
    expect(audit).toContain('"action":"explain"');
  });
});

async function seedDemoScan(
  scenario: 'startup' | 'enterprise' | 'minimal',
  options: {
    readonly injectArnIntoFirstNode?: boolean;
  } = {},
) {
  const cwd = createTempDirectory(`stronghold-explain-${scenario}-`);
  process.chdir(cwd);
  const results = await createDemoResults(scenario);
  const seededResults =
    options.injectArnIntoFirstNode && results.nodes[0]
      ? {
          ...results,
          nodes: results.nodes.map((node, index) =>
            index === 0
              ? {
                  ...node,
                  name: 'arn:aws:rds:eu-west-1:123456789012:db:payments-primary',
                  displayName: 'arn:aws:rds:eu-west-1:123456789012:db:payments-primary',
                }
              : node,
          ),
        }
      : results;
  const paths = resolveStrongholdPaths(cwd);
  saveScanResults(seededResults, paths.latestScanPath);
  const serviceId = seededResults.servicePosture?.services[0]?.service.id;
  if (!serviceId) {
    throw new Error('Demo scan did not contain any detected service.');
  }

  return {
    serviceId,
    paths,
  };
}
