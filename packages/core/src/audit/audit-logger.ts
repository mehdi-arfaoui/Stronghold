import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { AuditEntry } from './audit-types.js';

export interface AuditLogger {
  log(entry: AuditEntry): Promise<void>;
}

export class FileAuditLogger implements AuditLogger {
  public constructor(private readonly filePath: string) {}

  public async log(entry: AuditEntry): Promise<void> {
    const targetPath = path.resolve(this.filePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await appendFile(targetPath, `${JSON.stringify(normalizeAuditEntry(entry))}\n`, 'utf8');
  }
}

function normalizeAuditEntry(entry: AuditEntry): AuditEntry {
  return {
    timestamp: entry.timestamp,
    version: entry.version,
    action: entry.action,
    ...(entry.identity
      ? {
          identity: {
            arn: entry.identity.arn,
            accountId: entry.identity.accountId,
            userId: entry.identity.userId,
          },
        }
      : {}),
    parameters: {
      ...(entry.parameters.regions ? { regions: [...entry.parameters.regions] } : {}),
      ...(entry.parameters.services ? { services: [...entry.parameters.services] } : {}),
      ...(entry.parameters.outputFormat
        ? { outputFormat: entry.parameters.outputFormat }
        : {}),
      ...(entry.parameters.flags ? { flags: [...entry.parameters.flags] } : {}),
    },
    result: {
      status: entry.result.status,
      duration_ms: entry.result.duration_ms,
      ...(entry.result.resourceCount !== undefined
        ? { resourceCount: entry.result.resourceCount }
        : {}),
      ...(entry.result.errorMessage ? { errorMessage: entry.result.errorMessage } : {}),
    },
  };
}
