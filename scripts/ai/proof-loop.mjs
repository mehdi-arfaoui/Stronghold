import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function runProofLoop(options = {}) {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const workspace =
    options.workspace ?? fs.mkdtempSync(path.join(os.tmpdir(), 'stronghold-proof-loop-'));

  try {
    const cli = resolveCliRunner(repoRoot);

    const demo = runCli(cli, workspace, ['demo', '--output', 'summary']);
    assertExitCode(demo, 0, 'demo');

    const before = runCli(cli, workspace, ['contracts', 'validate', '--format', 'json'], {
      allowFailure: true,
    });
    const beforeJson = parseJsonOutput(before.stdout, 'initial contracts validate');
    assertSummary(beforeJson, {
      unknownAtLeast: 1,
      metExactly: 0,
      label: 'demo before evidence',
    });

    const serviceName = readDemoServiceName(workspace);
    const evidence = runCli(cli, workspace, [
      'evidence',
      'add',
      '--service',
      serviceName,
      '--scenario',
      'region_failure',
      '--type',
      'tested',
      '--rto',
      '45m',
      '--rpo',
      '2m',
    ]);
    assertExitCode(evidence, 0, 'evidence add');

    const after = runCli(cli, workspace, ['contracts', 'validate', '--format', 'json']);
    assertExitCode(after, 0, 'contracts validate after evidence');
    const afterJson = parseJsonOutput(after.stdout, 'final contracts validate');
    assertSummary(afterJson, {
      unknownExactly: 0,
      metAtLeast: 1,
      label: 'demo after measured evidence',
    });

    return {
      workspace,
      serviceName,
      before: beforeJson.globalSummary,
      after: afterJson.globalSummary,
    };
  } finally {
    if (!options.keepWorkspace) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
}

export function renderProofLoopResult(result) {
  return [
    'AI proof loop: PASS',
    `workspace: ${result.workspace}`,
    `service: ${result.serviceName}`,
    `before: UNKNOWN=${result.before.unknown} MET=${result.before.met}`,
    `after: UNKNOWN=${result.after.unknown} MET=${result.after.met}`,
    'flow: demo -> UNKNOWN -> measured evidence -> MET',
    '',
  ].join('\n');
}

function resolveCliRunner(repoRoot) {
  const cliDist = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

  if (fs.existsSync(cliDist)) {
    return [process.execPath, [cliDist]];
  }

  throw new Error('Compiled workspace artifacts are missing. Run: npm run build');
}

function runCli(cli, cwd, args, options = {}) {
  const [command, baseArgs] = cli;
  const result = spawnSync(command, [...baseArgs, ...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });

  const output = {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: stringify(result.stdout),
    stderr: stringify(result.stderr),
  };

  if (!options.allowFailure && output.exitCode !== 0) {
    throw new Error(
      `${args.join(' ')} failed with exit code ${output.exitCode}\n${output.stderr}${output.stdout}`,
    );
  }

  return output;
}

function assertExitCode(result, expected, label) {
  if (result.exitCode !== expected) {
    throw new Error(`${label} exited ${result.exitCode}, expected ${expected}\n${result.stderr}`);
  }
}

function assertSummary(json, expectation) {
  const summary = json.globalSummary;
  if (!summary || typeof summary !== 'object') {
    throw new Error(`${expectation.label} did not include globalSummary.`);
  }

  if (
    expectation.unknownAtLeast !== undefined &&
    summary.unknown < expectation.unknownAtLeast
  ) {
    throw new Error(`${expectation.label} expected UNKNOWN >= ${expectation.unknownAtLeast}.`);
  }

  if (
    expectation.unknownExactly !== undefined &&
    summary.unknown !== expectation.unknownExactly
  ) {
    throw new Error(`${expectation.label} expected UNKNOWN=${expectation.unknownExactly}.`);
  }

  if (expectation.metExactly !== undefined && summary.met !== expectation.metExactly) {
    throw new Error(`${expectation.label} expected MET=${expectation.metExactly}.`);
  }

  if (expectation.metAtLeast !== undefined && summary.met < expectation.metAtLeast) {
    throw new Error(`${expectation.label} expected MET >= ${expectation.metAtLeast}.`);
  }
}

function parseJsonOutput(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label} did not produce valid JSON: ${String(error)}`);
  }
}

function readDemoServiceName(workspace) {
  const contractsPath = path.join(workspace, '.stronghold', 'contracts.yml');
  const contents = fs.readFileSync(contractsPath, 'utf8');
  const match = contents.match(/service:\s*["']?([^"'\s]+)/u);
  if (!match?.[1]) {
    throw new Error('Could not resolve demo contract service name.');
  }
  return match[1];
}

function stringify(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return '';
}

function resolveRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

if (isMain()) {
  try {
    const result = runProofLoop({
      keepWorkspace: process.argv.includes('--keep'),
    });
    process.stdout.write(renderProofLoopResult(result));
  } catch (error) {
    process.stderr.write(`AI proof loop: FAIL\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
