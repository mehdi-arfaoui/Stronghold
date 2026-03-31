import path from 'node:path';

export interface StrongholdPaths {
  readonly rootDir: string;
  readonly latestScanPath: string;
  readonly baselineScanPath: string;
  readonly gitignorePath: string;
}

const STORAGE_DIRNAME = '.stronghold';
const LATEST_SCAN_FILENAME = 'latest-scan.json';
const BASELINE_SCAN_FILENAME = 'baseline-scan.json';
const GITIGNORE_FILENAME = '.gitignore';

export function resolveStrongholdPaths(cwd = process.cwd()): StrongholdPaths {
  const rootDir = path.resolve(cwd, STORAGE_DIRNAME);
  return {
    rootDir,
    latestScanPath: path.join(rootDir, LATEST_SCAN_FILENAME),
    baselineScanPath: path.join(rootDir, BASELINE_SCAN_FILENAME),
    gitignorePath: path.join(rootDir, GITIGNORE_FILENAME),
  };
}
