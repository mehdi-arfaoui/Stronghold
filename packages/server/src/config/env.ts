import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  STRONGHOLD_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'STRONGHOLD_ENCRYPTION_KEY must be a 32-byte hex string')
    .optional(),
});

export interface ServerConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly corsOrigin: string;
  readonly corsOrigins: readonly string[];
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly encryptionKey?: string;
}

export function parseEnvironment(environment: NodeJS.ProcessEnv): ServerConfig {
  const parsed = envSchema.parse(environment);

  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    nodeEnv: parsed.NODE_ENV,
    corsOrigin: parsed.CORS_ORIGIN,
    corsOrigins: parsed.CORS_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    logLevel: parsed.LOG_LEVEL,
    ...(parsed.STRONGHOLD_ENCRYPTION_KEY
      ? { encryptionKey: parsed.STRONGHOLD_ENCRYPTION_KEY }
      : {}),
  };
}

export function loadConfig(): ServerConfig {
  return parseEnvironment(process.env);
}

export function hasProductionLocalhostCors(config: ServerConfig): boolean {
  return (
    config.nodeEnv === 'production' &&
    config.corsOrigins.some((origin) => origin.toLowerCase().includes('localhost'))
  );
}
