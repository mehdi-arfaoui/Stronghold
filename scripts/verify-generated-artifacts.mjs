import { spawnSync } from 'node:child_process';
import process from 'node:process';

const TRACKED_RUNTIME_ARTIFACTS = [
  'github-action/dist/index.js',
  'packages/cli/bin/stronghold.js',
];

const npmCli = process.env.npm_execpath;
const npmCommand = npmCli ? process.execPath : 'npm';
const npmArgs = npmCli
  ? [npmCli, 'run', 'build', '--workspace=github-action']
  : ['run', 'build', '--workspace=github-action'];

const build = spawnSync(npmCommand, npmArgs, {
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit',
  windowsHide: true,
});

if (build.status !== 0) {
  if (build.error) {
    process.stderr.write(`${build.error.message}\n`);
  }
  process.exitCode = build.status ?? 1;
} else {
  const diff = spawnSync('git', ['diff', '--exit-code', '--', ...TRACKED_RUNTIME_ARTIFACTS], {
    encoding: 'utf8',
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (diff.status !== 0) {
    process.stderr.write(
      [
        'Generated runtime artifacts are out of date.',
        'Run: npm run artifacts:refresh',
        'Review and commit the generated artifact diff explicitly.',
        '',
      ].join('\n'),
    );
    process.exitCode = diff.status ?? 1;
  }
}
