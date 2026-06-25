import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOCS = [
  'docs/ai/current-state.md',
  'docs/ai/invariants.md',
  'docs/ai/architecture-map.md',
  'docs/ai/product-positioning.md',
  'docs/ai/active-risks.md',
];

export function collectState(root = resolveRepoRoot()) {
  return {
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    sha: git(root, ['rev-parse', '--short=12', 'HEAD']),
    docs: DOCS.map((docPath) => ({
      path: docPath,
      exists: fs.existsSync(path.join(root, docPath)),
    })),
  };
}

export function renderState(state) {
  const lines = [
    '# Stronghold AI State',
    '',
    `Git SHA: ${state.sha}`,
    `Branch: ${state.branch}`,
    '',
    '## Memory Files',
    '',
  ];

  for (const doc of state.docs) {
    lines.push(`- ${doc.exists ? 'OK' : 'MISSING'} ${doc.path}`);
  }

  lines.push('');
  lines.push('Use `npm run ai:context` for a compact working brief.');
  lines.push(
    'Note: ai:state, ai:context, and ai:impact are stdout-only, Git-SHA-tied, and should not be redirected into tracked files without deliberate review.',
  );
  return `${lines.join('\n')}\n`;
}

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return 'unknown';
  }
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

if (isMain()) {
  process.stdout.write(renderState(collectState()));
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
