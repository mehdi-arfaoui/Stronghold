import { describe, expect, it } from 'vitest';

import { decrypt, encrypt } from '../encryption-service.js';

describe('encryption-service', () => {
  it('encrypts then decrypts back to the original data', () => {
    const original = JSON.stringify({
      arn: 'arn:aws:rds:eu-west-1:123456789012:db:payments-primary',
      ip: '10.10.2.45',
    });
    const payload = encrypt(original, 'correct horse battery staple');

    expect(decrypt(payload, 'correct horse battery staple')).toBe(original);
  });

  it('throws a clear error when the passphrase is wrong', () => {
    const payload = encrypt('sensitive scan data', 'expected-passphrase');

    expect(() => decrypt(payload, 'wrong-passphrase')).toThrow(
      /Invalid passphrase or corrupted encrypted payload/,
    );
  });

  it('does not leak plaintext data in the payload', () => {
    const secret = 'arn:aws:rds:eu-west-1:123456789012:db:customer-payments';
    const payload = encrypt(secret, 'demo-passphrase');

    expect(JSON.stringify(payload)).not.toMatch(/customer-payments|123456789012/);
  });

  it('produces different payloads for the same input and passphrase', () => {
    const first = encrypt('same input', 'same passphrase');
    const second = encrypt('same input', 'same passphrase');

    expect(first).not.toEqual(second);
  });

  it('handles payloads larger than 1MB', () => {
    const largePayload = JSON.stringify({
      data: `prefix-${'a'.repeat(1_200_000)}-suffix`,
    });
    const encrypted = encrypt(largePayload, 'large-file-passphrase');

    expect(decrypt(encrypted, 'large-file-passphrase')).toBe(largePayload);
  });
});
