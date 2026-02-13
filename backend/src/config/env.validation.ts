import { z } from "zod";

const EnvironmentVariablesSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
    LICENSE_SIGNING_SECRET: z
      .string()
      .min(64, "LICENSE_SIGNING_SECRET must be at least 64 characters"),
    NODE_ENV: z.enum(["development", "staging", "production", "test"]),
    PORT: z.coerce.number().int().positive(),
    FRONTEND_URL: z.string().min(1, "FRONTEND_URL is required"),
    CORS_ORIGINS: z.string().optional(),
    CORS_ALLOWED_ORIGINS: z.string().optional(),

    DATABASE_POOL_SIZE: z.coerce.number().int().positive().optional(),
    REDIS_PASSWORD: z.string().optional(),
    JWT_EXPIRATION: z.string().optional(),
    BCRYPT_ROUNDS: z.coerce.number().int().positive().optional(),
    LICENSE_ISSUER: z.string().optional(),

    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_DEFAULT_REGION: z.string().optional(),
    AZURE_TENANT_ID: z.string().optional(),
    AZURE_CLIENT_ID: z.string().optional(),
    AZURE_CLIENT_SECRET: z.string().optional(),
    GCP_SERVICE_ACCOUNT_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    OWNER_EMAIL: z.string().optional(),
    OWNER_API_KEY: z.string().optional(),
  })
  .passthrough();

export type EnvironmentVariables = z.infer<typeof EnvironmentVariablesSchema>;

const isPlaceholderSecret = (value: string): boolean =>
  /change_me|dev-secret|example|dummy|test-only|not-for-production/i.test(value);

export function validateEnv(
  config: Record<string, string | undefined>
): EnvironmentVariables {
  const result = EnvironmentVariablesSchema.safeParse(config);
  if (!result.success) {
    const messages = result.error.issues.map((issue) => issue.message).join("\n");
    throw new Error(`Config validation error:\n${messages}`);
  }

  const validated = result.data;
  if (validated.NODE_ENV === "production") {
    const strictSecrets: Array<[keyof EnvironmentVariables, string]> = [
      ["JWT_SECRET", String(validated.JWT_SECRET)],
      ["SESSION_SECRET", String(validated.SESSION_SECRET)],
      ["LICENSE_SIGNING_SECRET", String(validated.LICENSE_SIGNING_SECRET)],
    ];

    for (const [key, value] of strictSecrets) {
      if (isPlaceholderSecret(value)) {
        throw new Error(`Config validation error:\n${String(key)} cannot be a placeholder in production`);
      }
    }
  }

  return validated;
}

export function loadValidatedEnv(): EnvironmentVariables {
  const validated = validateEnv(process.env);

  // Backward compatibility with current runtime keys.
  const corsOrigins =
    validated.CORS_ORIGINS || validated.CORS_ALLOWED_ORIGINS || validated.FRONTEND_URL;

  if (!process.env.CORS_ALLOWED_ORIGINS) {
    process.env.CORS_ALLOWED_ORIGINS = corsOrigins;
  }
  if (!process.env.CORS_ORIGIN) {
    process.env.CORS_ORIGIN = validated.FRONTEND_URL;
  }
  if (!process.env.CORS_ORIGINS) {
    process.env.CORS_ORIGINS = corsOrigins;
  }

  return validated;
}
