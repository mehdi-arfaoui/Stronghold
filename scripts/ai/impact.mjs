import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function buildImpact(root = resolveRepoRoot()) {
  const files = unique([
    ...gitLines(root, ['diff', '--name-only']),
    ...gitLines(root, ['diff', '--cached', '--name-only']),
    ...gitLines(root, ['ls-files', '--others', '--exclude-standard']),
  ]);

  return {
    files,
    categories: categorize(files),
    warnings: buildWarnings(files),
  };
}

export function renderImpact(impact) {
  const lines = ['# Stronghold AI Impact', ''];

  lines.push('## Changed Files');
  lines.push('');
  if (impact.files.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...impact.files.map((file) => `- ${file}`));
  }

  lines.push('');
  lines.push('## Categories');
  lines.push('');
  for (const category of impact.categories) {
    lines.push(`- ${category}`);
  }

  lines.push('');
  lines.push('## Warnings');
  lines.push('');
  if (impact.warnings.length === 0) {
    lines.push('- none');
  } else {
    lines.push(...impact.warnings.map((warning) => `- ${warning}`));
  }

  lines.push('');
  lines.push(
    'Note: ai:state, ai:context, and ai:impact are stdout-only, Git-SHA-tied, and should not be redirected into tracked files without deliberate review.',
  );

  return `${lines.join('\n')}\n`;
}

function categorize(files) {
  const categories = new Set();
  for (const file of files) {
    if (file.startsWith('packages/core/')) categories.add('core');
    if (file.startsWith('packages/cli/')) categories.add('cli');
    if (file.startsWith('packages/server/')) categories.add('server');
    if (file.startsWith('packages/web/')) categories.add('web');
    if (file.startsWith('docs/')) categories.add('docs');
    if (file.startsWith('scripts/')) categories.add('scripts');
    if (['AGENTS.md', 'CLAUDE.md', 'RTK.md', 'package.json'].includes(file)) {
      categories.add('repository-root');
    }
  }
  return categories.size > 0 ? [...categories].sort() : ['none'];
}

function buildWarnings(files) {
  const warnings = [];
  if (files.some((file) => file.startsWith('packages/web/') || file.startsWith('packages/server/'))) {
    warnings.push('Server or web changed; confirm the brief explicitly requested it.');
  }
  if (files.some((file) => file.includes('/providers/aws/services/'))) {
    warnings.push('AWS scanner changed; confirm scanner behavior was in scope.');
  }
  if (files.some((file) => file.startsWith('packages/core/src/contracts/'))) {
    warnings.push('Contract core changed; run native contract JSON validation and proof loop.');
  }
  if (files.some((file) => file.startsWith('scripts/ai/') || file.startsWith('docs/ai/'))) {
    warnings.push('AI memory/tooling changed; run ai:verify-invariants and ai:proof-loop.');
  }
  return warnings;
}

function gitLines(root, args) {
  try {
    const output = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
    return output.length > 0 ? output.split(/\r?\n/u) : [];
  } catch {
    return [];
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

if (isMain()) {
  process.stdout.write(renderImpact(buildImpact()));
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
