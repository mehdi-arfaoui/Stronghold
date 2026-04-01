import { z } from 'zod';

const redactQueryParamSchema = z
  .union([z.literal('true'), z.literal('false')])
  .optional()
  .transform((value) => value === 'true');

export const scanInputSchema = z
  .object({
    provider: z.enum(['aws']),
    regions: z.array(z.string().min(1)).min(1),
    services: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const driftCheckSchema = z
  .object({
    currentScanId: z.string().uuid(),
    baselineScanId: z.string().uuid(),
  })
  .strict();

export const planValidateSchema = z
  .object({
    planContent: z.string().min(1),
    scanId: z.string().uuid(),
  })
  .strict();

export const listScansQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().uuid().optional(),
});

export const reportQuerySchema = z.object({
  format: z.enum(['json', 'markdown']).default('json'),
  category: z
    .enum(['backup', 'redundancy', 'failover', 'detection', 'recovery', 'replication'])
    .optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  redact: redactQueryParamSchema,
});

export const reportSummaryQuerySchema = z.object({
  redact: redactQueryParamSchema,
});

export const planFormatQuerySchema = z.object({
  format: z.enum(['yaml', 'json']).default('yaml'),
});
