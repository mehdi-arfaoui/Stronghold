import { describe, expect, it } from 'vitest';

import { checkRtkStatus, renderRtkStatus } from '../rtk-status.mjs';

describe('rtk-status', () => {
  it('reports NOT INSTALLED without failing when rtk is absent', () => {
    const result = checkRtkStatus(() => ({
      status: null,
      stdout: '',
      stderr: '',
      error: { code: 'ENOENT' },
    }));

    expect(result.status).toBe('NOT INSTALLED');
    expect(renderRtkStatus(result)).toContain('configuration_changed: no');
  });

  it('runs version and gain when rtk is available', () => {
    const calls = [];
    const result = checkRtkStatus((command, args) => {
      calls.push([command, args]);
      return {
        status: 0,
        stdout: args[0] === '--version' ? 'rtk 1.2.3\n' : 'gain ok\n',
        stderr: '',
      };
    });

    expect(result.status).toBe('AVAILABLE');
    expect(calls).toEqual([
      ['rtk', ['--version']],
      ['rtk', ['gain']],
    ]);
  });

  it('reports WRONG RTK when the executable does not answer version', () => {
    const result = checkRtkStatus(() => ({
      status: 2,
      stdout: '',
      stderr: 'unknown option\n',
    }));

    expect(result.status).toBe('WRONG RTK');
  });
});
