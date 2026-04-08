import {
  FileAuditLogger,
  getCallerIdentity,
  type AuditAction,
  type AuditEntry,
  type AuditIdentity,
} from '@stronghold-dr/core';
import type { DiscoveryCloudCredentials } from '@stronghold-dr/core';

import { buildDiscoveryCredentials } from '../config/credentials.js';
import { writeError } from '../output/io.js';
import { resolveStrongholdPaths } from '../storage/paths.js';

const STRONGHOLD_VERSION = '1.0.0';

export class CommandAuditSession {
  private readonly logger = new FileAuditLogger(resolveStrongholdPaths().auditLogPath);
  private readonly startedAt = Date.now();
  private readonly timestamp = new Date(this.startedAt).toISOString();
  private identityPromise: Promise<AuditIdentity | undefined> = Promise.resolve(undefined);

  public constructor(
    private readonly action: AuditAction,
    private readonly parameters: AuditEntry['parameters'],
  ) {}

  public setIdentityPromise(identity: Promise<AuditIdentity | null>): void {
    this.identityPromise = identity
      .then((value) => value ?? undefined)
      .catch(() => undefined);
  }

  public async start(): Promise<void> {
    await this.write({
      status: 'partial',
      duration_ms: 0,
    });
  }

  public async finish(
    result: Omit<AuditEntry['result'], 'duration_ms'>,
  ): Promise<void> {
    await this.write({
      ...result,
      duration_ms: Date.now() - this.startedAt,
    });
  }

  public async fail(error: unknown, resourceCount?: number): Promise<void> {
    await this.finish({
      status: 'failure',
      ...(resourceCount !== undefined ? { resourceCount } : {}),
      errorMessage: resolveErrorMessage(error),
    });
  }

  private async write(result: AuditEntry['result']): Promise<void> {
    try {
      const identity = await this.identityPromise;
      await this.logger.log({
        timestamp: this.timestamp,
        version: STRONGHOLD_VERSION,
        action: this.action,
        ...(identity ? { identity } : {}),
        parameters: this.parameters,
        result,
      });
    } catch (error) {
      writeError(`Warning: failed to write audit log: ${resolveErrorMessage(error)}`);
    }
  }
}

export function collectAuditFlags(
  flags: Readonly<Record<string, boolean | undefined>>,
): readonly string[] | undefined {
  const enabled = Object.entries(flags)
    .filter(([, enabled]) => enabled)
    .map(([flag]) => flag);

  return enabled.length > 0 ? enabled : undefined;
}

export function resolveAuditIdentity(
  credentials: DiscoveryCloudCredentials = buildDiscoveryCredentials().aws ?? {},
): Promise<AuditIdentity | null> {
  return getCallerIdentity(credentials);
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
