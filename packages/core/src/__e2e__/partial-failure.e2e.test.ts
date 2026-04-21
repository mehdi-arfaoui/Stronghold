import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getE2EConfig, type E2EConfig } from './helpers/e2e-config.js';
import { runE2EScan } from './helpers/e2e-scan-runner.js';

const config = getE2EConfig();
const describeE2E = config ? describe : describe.skip;

describeE2E('Partial Failure E2E', () => {
  it('continues scanning when one account auth fails', async () => {
    const badConfig = await createBadStagingConfig(config!);
    const result = await runE2EScan(badConfig.path);

    expect(result).toBeDefined();

    const prodAccount = result.accounts.find(
      (account) => account.account.accountId === config!.prodAccountId,
    );
    expect(prodAccount).toBeDefined();
    expect(prodAccount?.resources.length).toBeGreaterThan(0);

    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    const stagingError = result.errors.find(
      (error) => error.account.accountId === config!.stagingAccountId,
    );
    expect(stagingError).toBeDefined();
    expect(stagingError?.phase).toBe('authentication');

    expect(result.summary.successfulAccounts).toBe(1);
    expect(result.summary.failedAccounts).toBe(1);
  }, 300_000);

  it('marks cross-account edges as partial when the staging account fails', async () => {
    const badConfig = await createBadStagingConfig(config!);
    const result = await runE2EScan(badConfig.path);
    const stagingEdges = result.crossAccount.edges.filter(
      (edge) =>
        edge.sourceAccountId === config!.stagingAccountId ||
        edge.targetAccountId === config!.stagingAccountId,
    );

    expect(stagingEdges.length).toBeGreaterThan(0);
    for (const edge of stagingEdges) {
      expect(edge.completeness).toBe('partial');
      expect(edge.missingAccountId).toBe(config!.stagingAccountId);
      expect(result.mergedGraph.hasEdge(`${edge.sourceArn}->${edge.targetArn}:cross_account`)).toBe(false);
    }
  }, 300_000);
});

async function createBadStagingConfig(config: E2EConfig): Promise<{ readonly path: string }> {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'stronghold-e2e-'));
  const targetPath = path.join(tempDirectory, 'bad-staging-config.yml');
  const contents = await readFile(config.configPath, 'utf8');
  const invalidProfile = 'nonexistent-profile-12345';
  const updatedContents = contents.replace(
    new RegExp(escapeRegExp(config.stagingProfile), 'g'),
    invalidProfile,
  );

  await writeFile(targetPath, updatedContents, 'utf8');
  return { path: targetPath };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
