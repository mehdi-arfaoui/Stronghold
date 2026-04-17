import { describe, expect, it } from 'vitest';

import { createAccountContext } from '../identity/index.js';
import { ScanErrorCollector } from './scan-error-collector.js';

describe('ScanErrorCollector', () => {
  it('reports an all-clear message when there are no errors', () => {
    const collector = new ScanErrorCollector();

    expect(collector.hasErrors()).toBe(false);
    expect(collector.formatForCli()).toBe('All clear. No account scan errors.');
  });

  it('formats account, phase, and message for CLI output', () => {
    const collector = new ScanErrorCollector();
    collector.add({
      account: createAccountContext({
        accountId: '111122223333',
        accountAlias: 'prod',
      }),
      phase: 'authentication',
      error: new Error('Access denied'),
      timestamp: new Date('2026-04-17T10:00:00.000Z'),
    });

    const output = collector.formatForCli();

    expect(output).toContain('prod (111122223333)');
    expect(output).toContain('[authentication]');
    expect(output).toContain('Access denied');
    expect(output).toContain('cross-account edges involving account 111122223333 may be incomplete');
  });

  it('detects when all accounts failed', () => {
    const collector = new ScanErrorCollector();

    collector.add({
      account: createAccountContext({ accountId: '111122223333' }),
      phase: 'scanning',
      error: new Error('first'),
      timestamp: new Date(),
    });
    collector.add({
      account: createAccountContext({ accountId: '444455556666' }),
      phase: 'processing',
      error: new Error('second'),
      timestamp: new Date(),
    });
    collector.add({
      account: createAccountContext({ accountId: '777788889999' }),
      phase: 'authentication',
      error: new Error('third'),
      timestamp: new Date(),
    });

    expect(collector.hasErrors()).toBe(true);
    expect(collector.allFailed(3)).toBe(true);
    expect(collector.allFailed(4)).toBe(false);
  });
});
