import { describe, expect, it } from 'vitest';

import { envSchema, parseEnvironment } from './env.js';

describe('envSchema', () => {
  it('parses valid environment variables', () => {
    const config = parseEnvironment({
      PORT: '3100',
      DATABASE_URL: 'postgresql://stronghold:stronghold@localhost:5432/stronghold',
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://stronghold.example',
      LOG_LEVEL: 'warn',
      STRONGHOLD_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });

    expect(config).toEqual({
      port: 3100,
      databaseUrl: 'postgresql://stronghold:stronghold@localhost:5432/stronghold',
      nodeEnv: 'production',
      corsOrigin: 'https://stronghold.example',
      corsOrigins: ['https://stronghold.example'],
      logLevel: 'warn',
      encryptionKey:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
  });

  it('uses defaults when optional variables are missing', () => {
    const config = parseEnvironment({
      DATABASE_URL: 'postgresql://stronghold:stronghold@localhost:5432/stronghold',
    });

    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.corsOrigin).toBe('http://localhost:5173');
    expect(config.logLevel).toBe('info');
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => envSchema.parse({})).toThrow();
  });

  it('fails when STRONGHOLD_ENCRYPTION_KEY is not a 32-byte hex string', () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://stronghold:stronghold@localhost:5432/stronghold',
        STRONGHOLD_ENCRYPTION_KEY: 'not-valid',
      }),
    ).toThrow(/STRONGHOLD_ENCRYPTION_KEY/);
  });
});
