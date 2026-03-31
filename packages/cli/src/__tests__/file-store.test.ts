import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadScanResults, saveScanResults } from '../storage/file-store.js';
import { createDemoResults, createTempDirectory } from './test-utils.js';

describe('file-store', () => {
  it('saveScanResults and loadScanResults round-trip a scan result', async () => {
    const directory = createTempDirectory('stronghold-file-store-');
    const scanPath = path.join(directory, '.stronghold', 'latest-scan.json');
    const results = await createDemoResults('minimal');

    saveScanResults(results, scanPath);
    const loaded = loadScanResults(scanPath);

    expect(loaded).toEqual(results);
  });

  it('saveScanResults creates the .stronghold directory when missing', async () => {
    const directory = createTempDirectory('stronghold-file-store-');
    const scanPath = path.join(directory, '.stronghold', 'latest-scan.json');

    saveScanResults(await createDemoResults('minimal'), scanPath);

    expect(fs.existsSync(path.dirname(scanPath))).toBe(true);
  });

  it('loadScanResults on a missing file throws a clear error', () => {
    const missingPath = path.join(createTempDirectory('stronghold-file-store-'), 'missing.json');

    expect(() => loadScanResults(missingPath)).toThrow(/No scan results found/);
  });

  it('creates a .gitignore on first save', async () => {
    const directory = createTempDirectory('stronghold-file-store-');
    const scanPath = path.join(directory, '.stronghold', 'latest-scan.json');

    saveScanResults(await createDemoResults('minimal'), scanPath);

    expect(fs.existsSync(path.join(directory, '.stronghold', '.gitignore'))).toBe(true);
  });

  it('serializes ScanResults with isDemo set to true', async () => {
    const directory = createTempDirectory('stronghold-file-store-');
    const scanPath = path.join(directory, '.stronghold', 'latest-scan.json');
    const results = await createDemoResults('startup');

    saveScanResults(results, scanPath);
    const loaded = loadScanResults(scanPath);

    expect(loaded.isDemo).toBe(true);
  });
});
