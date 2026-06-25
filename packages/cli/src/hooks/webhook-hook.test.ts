import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContractHookConfig, ContractHookPayload } from '@stronghold-dr/core';

import { WebhookHook } from './webhook-hook.js';

describe('WebhookHook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts the contract payload', async () => {
    const fetchMock = mockFetch(Promise.resolve(new Response(null, { status: 202 })));
    const warnings: string[] = [];
    const hook = new WebhookHook((message) => warnings.push(message));

    await hook.fire(config(), payload());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://hooks.example.com/services/secret-token');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual(payload());
    expect(warnings).toEqual([]);
  });

  it('uses a 10s timeout signal and logs timeout failures without crashing', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    mockFetch(Promise.reject(new DOMException('operation timed out', 'TimeoutError')));
    const warnings: string[] = [];
    const hook = new WebhookHook((message) => warnings.push(message));

    await hook.fire(config(), payload());
    await flushMicrotasks();

    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(warnings).toEqual([
      'Warning: webhook hook to hooks.example.com failed (timeout after 10s).',
    ]);
  });

  it('logs HTTP 500 without throwing', async () => {
    mockFetch(Promise.resolve(new Response(null, { status: 500 })));
    const warnings: string[] = [];
    const hook = new WebhookHook((message) => warnings.push(message));

    await hook.fire(config(), payload());
    await flushMicrotasks();

    expect(warnings).toEqual([
      'Warning: webhook hook to hooks.example.com returned HTTP 500.',
    ]);
  });

  it('logs network errors without throwing', async () => {
    mockFetch(Promise.reject(new TypeError('connection failed')));
    const warnings: string[] = [];
    const hook = new WebhookHook((message) => warnings.push(message));

    await hook.fire(config(), payload());
    await flushMicrotasks();

    expect(warnings).toEqual([
      'Warning: webhook hook to hooks.example.com failed (TypeError).',
    ]);
  });

  it('does not log the complete webhook URL', async () => {
    mockFetch(Promise.reject(new Error('failed https://hooks.example.com/services/secret-token')));
    const warnings: string[] = [];
    const hook = new WebhookHook((message) => warnings.push(message));

    await hook.fire(config(), payload());
    await flushMicrotasks();

    expect(warnings.join('\n')).toContain('hooks.example.com');
    expect(warnings.join('\n')).not.toContain('/services/secret-token');
  });

  it('warns clearly when native fetch is unavailable', async () => {
    vi.stubGlobal('fetch', undefined);
    const warnings: string[] = [];
    const hook = new WebhookHook((message) => warnings.push(message));

    await hook.fire(config(), payload());

    expect(warnings).toEqual(['Warning: Node.js 18+ required for webhook hooks.']);
  });
});

function mockFetch(
  response: Promise<Response>,
): ReturnType<typeof vi.fn<(input: string, init?: RequestInit) => Promise<Response>>> {
  const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
    .mockReturnValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function config(): ContractHookConfig {
  return {
    type: 'webhook',
    url: 'https://hooks.example.com/services/secret-token',
    on: ['violated'],
  };
}

function payload(): ContractHookPayload {
  return {
    event: 'contract_evaluated',
    timestamp: '2026-06-14T00:00:00.000Z',
    strongholdVersion: '2.0.0',
    contract: {
      service: 'payment-processing',
      enforcement: 'enforce',
      verdict: 'violated',
      summary: {
        met: 0,
        violated: 1,
        unknown: 0,
        notApplicable: 0,
        total: 1,
      },
    },
    violations: [
      {
        scenario: 'az-failure',
        failedDimensions: [
          {
            dimension: 'rto',
            required: '<= 1h',
            actual: '90m',
            reason: 'Measured RTO exceeds required value.',
          },
        ],
      },
    ],
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
