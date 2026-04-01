import type { AuditAction, AuditEntry, AuditLogger, Logger } from '@stronghold-dr/core';

const STRONGHOLD_VERSION = '0.1.0';

export class RequestAuditSession {
  private readonly startedAt = Date.now();
  private readonly timestamp = new Date(this.startedAt).toISOString();

  public constructor(
    private readonly auditLogger: AuditLogger,
    private readonly logger: Logger,
    private readonly action: AuditAction,
    private readonly parameters: AuditEntry['parameters'],
  ) {}

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
      await this.auditLogger.log({
        timestamp: this.timestamp,
        version: STRONGHOLD_VERSION,
        action: this.action,
        parameters: this.parameters,
        result,
      });
    } catch (error) {
      this.logger.warn('audit.write.failed', {
        action: this.action,
        error: resolveErrorMessage(error),
      });
    }
  }
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
