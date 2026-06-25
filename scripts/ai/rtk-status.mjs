import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const STATUS = {
  AVAILABLE: 'AVAILABLE',
  NOT_INSTALLED: 'NOT INSTALLED',
  WRONG_RTK: 'WRONG RTK',
  ERROR: 'ERROR',
};

export function checkRtkStatus(spawn = spawnSync) {
  const version = run(spawn, 'rtk', ['--version']);
  if (version.errorCode === 'ENOENT') {
    return {
      status: STATUS.NOT_INSTALLED,
      version: null,
      gain: null,
      detail: 'rtk was not found on PATH.',
    };
  }

  if (version.errorCode) {
    return {
      status: STATUS.ERROR,
      version: null,
      gain: null,
      detail: `rtk --version failed before execution: ${version.errorCode}`,
    };
  }

  if (version.exitCode !== 0) {
    return {
      status: STATUS.WRONG_RTK,
      version: trimOutput(version.output),
      gain: null,
      detail: 'rtk exists, but rtk --version did not succeed.',
    };
  }

  const gain = run(spawn, 'rtk', ['gain']);
  if (gain.errorCode) {
    return {
      status: STATUS.ERROR,
      version: trimOutput(version.output),
      gain: null,
      detail: `rtk gain failed before execution: ${gain.errorCode}`,
    };
  }

  if (gain.exitCode !== 0) {
    return {
      status: STATUS.ERROR,
      version: trimOutput(version.output),
      gain: trimOutput(gain.output),
      detail: 'rtk gain returned a non-zero exit code.',
    };
  }

  return {
    status: STATUS.AVAILABLE,
    version: trimOutput(version.output),
    gain: trimOutput(gain.output),
    detail: 'RTK is available. Stronghold will still use native commands for evidence, CI truth, proof loops, release checks, audit exports, and exact JSON/YAML.',
  };
}

export function renderRtkStatus(result) {
  const lines = [`RTK: ${result.status}`];
  if (result.version) {
    lines.push(`version: ${singleLine(result.version)}`);
  }
  if (result.gain) {
    lines.push(`gain: ${singleLine(result.gain)}`);
  }
  lines.push(`detail: ${result.detail}`);
  lines.push('configuration_changed: no');
  lines.push('external_data_sent: no');
  return `${lines.join('\n')}\n`;
}

function run(spawn, command, args) {
  const result = spawn(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });

  return {
    exitCode: typeof result.status === 'number' ? result.status : 1,
    output: `${stringifyOutput(result.stdout)}${stringifyOutput(result.stderr)}`,
    errorCode: typeof result.error?.code === 'string' ? result.error.code : null,
  };
}

function stringifyOutput(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return '';
}

function trimOutput(value) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function singleLine(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

if (isMain()) {
  process.stdout.write(renderRtkStatus(checkRtkStatus()));
}

function isMain() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}
