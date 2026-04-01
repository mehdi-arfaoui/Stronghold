import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProgram } from '../index.js';
import { validateOverridesCommand } from '../commands/overrides.js';
import { saveScanResults } from '../storage/file-store.js';
import { saveScanResultsWithEncryption } from '../storage/secure-file-store.js';
import { createDemoResults, createTempDirectory } from './test-utils.js';

function writeOverridesFile(rootDir: string, contents: string): string {
  const targetPath = path.join(rootDir, '.stronghold', 'overrides.yml');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${contents}\n`, 'utf8');
  return targetPath;
}

describe('overrides command', () => {
  it('init creates a commented template and does not overwrite an existing file', async () => {
    const directory = createTempDirectory('stronghold-overrides-cli-');
    const targetPath = path.join(directory, '.stronghold', 'overrides.yml');

    await createProgram().parseAsync([
      'node',
      'stronghold',
      'overrides',
      'init',
      '--path',
      targetPath,
    ]);

    expect(fs.existsSync(targetPath)).toBe(true);
    const initialContents = fs.readFileSync(targetPath, 'utf8');
    expect(initialContents).toContain('criticality_overrides:');

    await expect(
      createProgram().parseAsync([
        'node',
        'stronghold',
        'overrides',
        'init',
        '--path',
        targetPath,
      ]),
    ).rejects.toThrow(/already exists/);
  });

  it('validate falls back to structure-only checks when no last scan artifact exists', async () => {
    const previousCwd = process.cwd();
    const directory = createTempDirectory('stronghold-overrides-cli-');

    try {
      process.chdir(directory);
      writeOverridesFile(
        directory,
        [
          'version: 1',
          'add_edges: []',
          'remove_edges: []',
          'criticality_overrides:',
          '  - node: app',
          '    score: 85',
          '    reason: app is critical',
        ].join('\n'),
      );

      const result = await validateOverridesCommand({});

      expect(result.valid).toBe(true);
      expect(result.structureOnly).toBe(true);
      expect(result.messages.join('\n')).toContain('Validated structure only.');
      expect(result.messages.join('\n')).toContain('latest-scan.json');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('validate checks node references against the explicit scan artifact when present', async () => {
    const directory = createTempDirectory('stronghold-overrides-cli-');
    const scanPath = path.join(directory, '.stronghold', 'latest-scan.json');
    const results = await createDemoResults('minimal');
    saveScanResults(results, scanPath);
    const nodeId = results.nodes[0]?.id ?? 'missing-node';
    const overridesPath = writeOverridesFile(
      directory,
      [
        'version: 1',
        'add_edges: []',
        'remove_edges: []',
        'criticality_overrides:',
        `  - node: ${nodeId}`,
        '    score: 91',
        '    reason: validated against the saved scan',
      ].join('\n'),
    );

    const result = await validateOverridesCommand({
      path: overridesPath,
      scan: scanPath,
    });

    expect(result.valid).toBe(true);
    expect(result.structureOnly).toBe(false);
    expect(result.messages.join('\n')).toContain('Validated node references against scan artifact');
  });

  it('validate falls back to structure-only checks when the implicit last scan is encrypted and no passphrase is provided', async () => {
    const previousCwd = process.cwd();
    const directory = createTempDirectory('stronghold-overrides-cli-');
    const results = await createDemoResults('minimal');

    try {
      process.chdir(directory);
      await saveScanResultsWithEncryption(results, path.join(directory, '.stronghold', 'latest-scan.json'), {
        encrypt: true,
        passphrase: 'test-passphrase',
      });
      writeOverridesFile(
        directory,
        [
          'version: 1',
          'add_edges: []',
          'remove_edges: []',
          'criticality_overrides:',
          '  - node: app',
          '    score: 85',
          '    reason: app is critical',
        ].join('\n'),
      );

      const result = await validateOverridesCommand({});

      expect(result.valid).toBe(true);
      expect(result.structureOnly).toBe(true);
      expect(result.scanPath).toContain('latest-scan.stronghold-enc');
      expect(result.messages.join('\n')).toContain('Skipped automatic node reference validation');
      expect(result.messages.join('\n')).toContain('--passphrase <string>');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('validate reports missing node references when a scan artifact exists', async () => {
    const directory = createTempDirectory('stronghold-overrides-cli-');
    const scanPath = path.join(directory, '.stronghold', 'latest-scan.json');
    const results = await createDemoResults('minimal');
    saveScanResults(results, scanPath);
    const overridesPath = writeOverridesFile(
      directory,
      [
        'version: 1',
        'add_edges:',
        '  - source: missing-source',
        '    target: missing-target',
        '    type: DEPENDS_ON',
        '    reason: missing references',
        'remove_edges: []',
        'criticality_overrides: []',
      ].join('\n'),
    );

    const result = await validateOverridesCommand({
      path: overridesPath,
      scan: scanPath,
    });

    expect(result.valid).toBe(false);
    expect(result.messages.join('\n')).toContain("add_edges source 'missing-source'");
    expect(result.messages.join('\n')).toContain("add_edges target 'missing-target'");
  });
});
