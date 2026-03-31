import { describe, expect, it } from 'vitest';

import { scanInputSchema, driftCheckSchema, planValidateSchema } from './routes/route-schemas.js';
import { isValidUUID } from './utils/uuid.js';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('route validation schemas', () => {
  it('accepts a valid scan payload', () => {
    const result = scanInputSchema.safeParse({
      provider: 'aws',
      regions: ['eu-west-1'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects an unknown provider', () => {
    const result = scanInputSchema.safeParse({
      provider: 'azure',
      regions: ['eu-west-1'],
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty regions', () => {
    const result = scanInputSchema.safeParse({
      provider: 'aws',
      regions: [],
    });

    expect(result.success).toBe(false);
  });

  it('accepts optional services', () => {
    const result = scanInputSchema.safeParse({
      provider: 'aws',
      regions: ['eu-west-1'],
      services: ['rds', 'aurora'],
    });

    expect(result.success).toBe(true);
  });

  it('rejects unexpected credentials', () => {
    const result = scanInputSchema.safeParse({
      provider: 'aws',
      regions: ['eu-west-1'],
      credentials: {
        accessKeyId: 'abc',
      },
    });

    expect(result.success).toBe(false);
  });

  it('accepts valid drift UUIDs', () => {
    const result = driftCheckSchema.safeParse({
      currentScanId: VALID_UUID,
      baselineScanId: VALID_UUID,
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid drift UUID', () => {
    const result = driftCheckSchema.safeParse({
      currentScanId: 'not-a-uuid',
      baselineScanId: VALID_UUID,
    });

    expect(result.success).toBe(false);
  });

  it('accepts a valid plan validation payload', () => {
    const result = planValidateSchema.safeParse({
      planContent: 'version: 1.0.0',
      scanId: VALID_UUID,
    });

    expect(result.success).toBe(true);
  });
});

describe('isValidUUID', () => {
  it('accepts a valid v4 UUID', () => {
    expect(isValidUUID(VALID_UUID)).toBe(true);
  });

  it('rejects a random string', () => {
    expect(isValidUUID('definitely-not-a-uuid')).toBe(false);
  });
});
