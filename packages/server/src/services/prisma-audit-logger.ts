import type { PrismaClient } from '@prisma/client';
import type { AuditEntry, AuditIdentity, AuditLogger } from '@stronghold-dr/core';

import { toPrismaJson } from '../utils/prisma-json.js';

export interface StoredAuditLog extends AuditEntry {
  readonly id: string;
  readonly createdAt: Date;
}

export interface ListAuditLogsResult {
  readonly entries: readonly StoredAuditLog[];
  readonly nextCursor?: string;
}

export class PrismaAuditLogger implements AuditLogger {
  public constructor(private readonly prisma: PrismaClient) {}

  public async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        timestamp: new Date(entry.timestamp),
        action: entry.action,
        ...(entry.identity ? { identity: toPrismaJson(entry.identity) } : {}),
        parameters: toPrismaJson(entry.parameters),
        result: toPrismaJson(entry.result),
      },
    });
  }

  public async list(options: {
    readonly limit: number;
    readonly cursor?: string;
  }): Promise<ListAuditLogsResult> {
    const records = await this.prisma.auditLog.findMany({
      take: options.limit + 1,
      ...(options.cursor
        ? {
            cursor: { id: options.cursor },
            skip: 1,
          }
        : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const hasNextPage = records.length > options.limit;
    const entries = records.slice(0, options.limit).map((record) => ({
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      version: '1.0.0',
      action: record.action as AuditEntry['action'],
      ...(record.identity
        ? { identity: record.identity as unknown as AuditIdentity }
        : {}),
      parameters: record.parameters as unknown as AuditEntry['parameters'],
      result: record.result as unknown as AuditEntry['result'],
      createdAt: record.createdAt,
    }));
    const nextCursor = hasNextPage ? entries.at(-1)?.id : undefined;

    return {
      entries,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }
}
