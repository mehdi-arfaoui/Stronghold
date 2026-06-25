import type {
  ContractHook,
  ContractHookConfig,
  ContractHookPayload,
} from '@stronghold-dr/core';

import { writeError } from '../output/io.js';

const WEBHOOK_TIMEOUT_MS = 10_000;

export type WebhookHookWarn = (message: string) => void;

/**
 * Fire-and-forget webhook adapter for contract notifications.
 */
export class WebhookHook implements ContractHook {
  public constructor(private readonly warn: WebhookHookWarn = writeError) {}

  public async fire(
    config: ContractHookConfig,
    payload: ContractHookPayload,
  ): Promise<void> {
    if (typeof fetch !== 'function') {
      this.warn('Warning: Node.js 18+ required for webhook hooks.');
      return;
    }

    const hostname = resolveHostname(config.url);
    const request = fetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
      .then((response) => {
        if (!response.ok) {
          this.warn(
            `Warning: webhook hook to ${hostname} returned HTTP ${response.status}.`,
          );
        }
      })
      .catch((error: unknown) => {
        this.warn(
          `Warning: webhook hook to ${hostname} failed (${formatFailure(error)}).`,
        );
      });

    void request;
  }
}

function resolveHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'configured host';
  }
}

function formatFailure(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'timeout after 10s';
  }
  if (error instanceof Error && error.name.length > 0) {
    return error.name;
  }

  return 'network error';
}
