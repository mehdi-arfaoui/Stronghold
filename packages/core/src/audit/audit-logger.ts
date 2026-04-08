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
      ...(entry.parameters.profile ? { profile: entry.parameters.profile } : {}),
      ...(entry.parameters.concurrency !== undefined
        ? { concurrency: entry.parameters.concurrency }
        : {}),
      ...(entry.parameters.scannerTimeoutSeconds !== undefined
        ? { scannerTimeoutSeconds: entry.parameters.scannerTimeoutSeconds }
        : {}),
      ...(entry.parameters.roleArn ? { roleArn: entry.parameters.roleArn } : {}),
      ...(entry.parameters.accountName ? { accountName: entry.parameters.accountName } : {}),
      ...(entry.parameters.outputFormat
        ? { outputFormat: entry.parameters.outputFormat }
        : {}),
      ...(entry.parameters.flags ? { flags: [...entry.parameters.flags] } : {}),
      ...(entry.parameters.governancePath
        ? { governancePath: entry.parameters.governancePath }
        : {}),
      ...(entry.parameters.findingKey ? { findingKey: entry.parameters.findingKey } : {}),
      ...(entry.parameters.acceptanceId ? { acceptanceId: entry.parameters.acceptanceId } : {}),
      ...(entry.parameters.acceptedBy ? { acceptedBy: entry.parameters.acceptedBy } : {}),
      ...(entry.parameters.justification
        ? { justification: entry.parameters.justification }
        : {}),
      ...(entry.parameters.expiresAt ? { expiresAt: entry.parameters.expiresAt } : {}),
      ...(entry.parameters.policyId ? { policyId: entry.parameters.policyId } : {}),
      ...(entry.parameters.policyName ? { policyName: entry.parameters.policyName } : {}),
      ...(entry.parameters.serviceId ? { serviceId: entry.parameters.serviceId } : {}),
      ...(entry.parameters.owner ? { owner: entry.parameters.owner } : {}),
      ...(entry.parameters.confirmedAt ? { confirmedAt: entry.parameters.confirmedAt } : {}),
      ...(entry.parameters.nextReviewAt ? { nextReviewAt: entry.parameters.nextReviewAt } : {}),
      ...(entry.parameters.severity ? { severity: entry.parameters.severity } : {}),
      ...(entry.parameters.note ? { note: entry.parameters.note } : {}),
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
