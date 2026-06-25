import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { runProofLoop } from '../proof-loop.mjs';

describe('proof-loop', () => {
  it('reports missing compiled artifacts with the bootstrap command', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-proof-repo-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-proof-workspace-'));

    expect(() => runProofLoop({ repoRoot, workspace })).toThrow(
      'Compiled workspace artifacts are missing. Run: npm run build',
    );
    expect(fs.existsSync(workspace)).toBe(false);
  });

  it('keeps a failed workspace when explicitly requested', () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-proof-repo-'));
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-proof-workspace-'));

    expect(() => runProofLoop({ repoRoot, workspace, keepWorkspace: true })).toThrow(
      'Compiled workspace artifacts are missing. Run: npm run build',
    );
    expect(fs.existsSync(workspace)).toBe(true);

    fs.rmSync(workspace, { recursive: true, force: true });
  });
});
