import { z } from 'zod';

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL');

const secret = z.string().min(32, 'must be at least 32 characters');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.url(),
  CONTROL_DATABASE_URL: postgresUrl,
  SHARD_A_DATABASE_URL: postgresUrl,
  SHARD_B_DATABASE_URL: postgresUrl,
  REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
  SESSION_SECRET: secret,
  CURSOR_SECRET: secret,
  INSTANCE_ID: z.string().min(1).max(32).default('local'),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Injection token for the validated configuration object. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Validates environment variables at startup so a bad configuration fails fast.
 * The error lists variable names and rules only, never the values (they may be secrets).
 */
export function parseEnv(env: NodeJS.ProcessEnv): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  }
  return result.data;
}
