import fs from 'node:fs';
import path from 'node:path';

import { ENCRYPTED_FILE_EXTENSION } from './secure-file-store.js';

export interface StrongholdPaths {
  readonly rootDir: string;
  readonly latestScanPath: string;
  readonly latestEncryptedScanPath: string;
  readonly baselineScanPath: string;
  readonly baselineEncryptedScanPath: string;
  readonly auditLogPath: string;
  readonly evidencePath: string;
  readonly historyPath: string;
  readonly findingLifecyclesPath: string;
  readonly servicesPath: string;
  readonly governancePath: string;
  readonly gitignorePath: string;
}

const STORAGE_DIRNAME = '.stronghold';
const LATEST_SCAN_FILENAME = 'latest-scan.json';
const BASELINE_SCAN_FILENAME = 'baseline-scan.json';
const AUDIT_LOG_FILENAME = 'audit.jsonl';
const EVIDENCE_FILENAME = 'evidence.jsonl';
const HISTORY_FILENAME = 'history.jsonl';
const FINDING_LIFECYCLES_FILENAME = 'finding-lifecycles.json';
const SERVICES_FILENAME = 'services.yml';
const GOVERNANCE_FILENAME = 'governance.yml';
const GITIGNORE_FILENAME = '.gitignore';

export function resolveStrongholdPaths(cwd = process.cwd()): StrongholdPaths {
  const rootDir = path.resolve(cwd, STORAGE_DIRNAME);
  return {
    rootDir,
    latestScanPath: path.join(rootDir, LATEST_SCAN_FILENAME),
    latestEncryptedScanPath: path.join(rootDir, `latest-scan${ENCRYPTED_FILE_EXTENSION}`),
    baselineScanPath: path.join(rootDir, BASELINE_SCAN_FILENAME),
    baselineEncryptedScanPath: path.join(rootDir, `baseline-scan${ENCRYPTED_FILE_EXTENSION}`),
    auditLogPath: path.join(rootDir, AUDIT_LOG_FILENAME),
    evidencePath: path.join(rootDir, EVIDENCE_FILENAME),
    historyPath: path.join(rootDir, HISTORY_FILENAME),
    findingLifecyclesPath: path.join(rootDir, FINDING_LIFECYCLES_FILENAME),
    servicesPath: path.join(rootDir, SERVICES_FILENAME),
    governancePath: path.join(rootDir, GOVERNANCE_FILENAME),
    gitignorePath: path.join(rootDir, GITIGNORE_FILENAME),
  };
}

export function resolvePreferredScanPath(encryptedPath: string, plainPath: string): string {
  return fs.existsSync(encryptedPath) ? encryptedPath : plainPath;
}
