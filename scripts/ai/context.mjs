import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TESTS = [
  'npm run ai:verify-invariants',
  'npm run ai:proof-loop',
  'npm run typecheck',
  'npm run lint',
  'npm run test',
  'npm run build',
];

export function buildContext(root = resolveRepoRoot()) {
  const changedFiles = unique([
    ...gitLines(root, ['diff', '--name-only']),
    ...gitLines(root, ['diff', '--cached', '--name-only']),
    ...gitLines(root, ['ls-files', '--others', '--exclude-standard']),
  ]);

  return {
    sha: git(root, ['rev-parse', '--short=12', 'HEAD']),
    branch: git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    activePhase: readActivePhase(root),
    invariants: readRelevantInvariants(root),
    likelyFiles: changedFiles.length > 0 ? changedFiles : defaultLikelyFiles(),
    tests: TESTS,
    recentCommits: gitLines(root, ['log', '-5', '--oneline']),
    knownRisks: readKnownRisks(root),
  };
}

export function renderContext(context) {
  const lines = [
    '# Stronghold AI Context',
    '',
    `Git SHA: ${context.sha}`,
    `Branch: ${context.branch}`,
    `Active phase: ${context.activePhase}`,
    '',
    '## Relevant Invariants',
    '',
    ...context.invariants.map((item) => `- ${item}`),
    '',
    '## Likely Files',
    '',
    ...context.likelyFiles.map((item) => `- ${item}`),
    '',
    '## Tests',
    '',
    ...context.tests.map((item) => `- ${item}`),
    '',
    '## Recent Commits',
    '',
    ...context.recentCommits.map((item) => `- ${item}`),
    '',
    '## Known Risks',
    '',
    ...context.knownRisks.map((item) => `- ${item}`),
    '',
    'Note: ai:state, ai:context, and ai:impact are stdout-only, Git-SHA-tied, and should not be redirected into tracked files without deliberate review.',
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function readActivePhase(root) {
  const contents = readOptional(root, 'docs/ai/current-state.md');
  const match = contents.match(/^Active phase:\s*(.+)$/mu);
  return match?.[1]?.trim() ?? 'unknown';
}

function readRelevantInvariants(root) {
  const contents = readOptional(root, 'docs/ai/invariants.md');
  return contents
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter((line) =>
      /RTO|RPO|UNKNOWN|Core|AWS|service-centric|deterministic|Hooks|LLM|JSON/iu.test(line),
    )
    .slice(0, 9);
}

function readKnownRisks(root) {
  return readOptional(root, 'docs/ai/active-risks.md')
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .slice(0, 6);
}

function defaultLikelyFiles() {
  return [
    'AGENTS.md',
    'CLAUDE.md',
    'RTK.md',
    'docs/ai/',
    'scripts/ai/',
    'package.json',
  ];
}

function readOptional(root, relativePath) {
  const absolute = path.join(root, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
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

function gitLines(root, args) {
  const output = git(root, args);
  return output === 'unknown' || output.length === 0 ? [] : output.split(/\r?\n/u);
}

function unique(values) {
  return [...new Set(values)].sort();
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

if (isMain()) {
  process.stdout.write(renderContext(buildContext()));
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
