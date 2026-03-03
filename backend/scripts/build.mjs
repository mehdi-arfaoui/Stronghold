import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const buildTarget = process.env.BUILD_TARGET === 'client' ? 'client' : 'internal';
const tsconfig = buildTarget === 'client' ? 'tsconfig.client.json' : 'tsconfig.json';

rmSync('dist', { recursive: true, force: true });

const command = process.execPath;

const tscResult = spawnSync(
  command,
  ['node_modules/typescript/bin/tsc', '-p', tsconfig],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

if (typeof tscResult.status === 'number' && tscResult.status !== 0) {
  process.exit(tscResult.status);
}

const copyResult = spawnSync(
  command,
  ['scripts/copy-scenarios.mjs'],
  {
    stdio: 'inherit',
    env: process.env,
  },
);

if (typeof copyResult.status === 'number') {
  process.exit(copyResult.status);
}

process.exit(1);
