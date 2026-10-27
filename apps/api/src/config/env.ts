import { z } from 'zod';

const postgresUrl = z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection URL');

const secret = z.string().min(32, 'must be at least 32 characters');

const positiveInt = (fallback: number) => z.coerce.number().int().min(1).default(fallback);

const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    /** The one browser origin allowed to send unsafe requests (exact match). */
    APP_ORIGIN: z.url(),
    CONTROL_DATABASE_URL: postgresUrl,
    SHARD_A_DATABASE_URL: postgresUrl,
    SHARD_B_DATABASE_URL: postgresUrl,
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'must be a redis:// URL'),
    /** Namespaces every Redis key (sessions, limits, cache) so test runs never collide with dev data. */
    REDIS_KEY_PREFIX: z
      .string()
      .regex(/^[a-z0-9:_-]{1,40}:$/, 'must be lowercase and end with ":"')
      .default('trp:'),
    SESSION_SECRET: secret,
    CURSOR_SECRET: secret,
    INSTANCE_ID: z.string().min(1).max(32).default('local'),
    /** Local demo evidence only: answer with X-Instance-ID so you can see which replica served. */
    EXPOSE_INSTANCE_ID: flag(false),
    /** One structured log line per request (id, route, status, duration, instance). */
    LOG_REQUESTS: flag(true),
    /** Dashboard counts may be this many seconds old (architecture.md section 9). */
    DASHBOARD_CACHE_TTL_SECONDS: positiveInt(5),
    /** Authenticated API calls per user + tenant per minute, shared by every replica. */
    API_LIMIT_PER_MINUTE: positiveInt(120),
    // Session lifetime (architecture.md section 6): 30 minutes idle, 8 hours absolute.
    SESSION_IDLE_SECONDS: positiveInt(1800),
    SESSION_ABSOLUTE_SECONDS: positiveInt(28800),
    // Shared limits (architecture.md section 9). Configurable so tests can use small thresholds.
    LIMIT_WINDOW_SECONDS: positiveInt(900),
    LOGIN_LIMIT_PER_ACCOUNT: positiveInt(5),
    LOGIN_LIMIT_PER_IP: positiveInt(30),
    SESSION_CREATE_LIMIT_PER_IP: positiveInt(60),
    PASSWORD_CHANGE_LIMIT_PER_USER: positiveInt(5),
  })
  .superRefine((env, ctx) => {
    // Plain HTTP is allowed only on this machine; anything else must be HTTPS (Secure cookies).
    const origin = new URL(env.APP_ORIGIN);
    if (origin.protocol !== 'https:' && !LOOPBACK_HOSTS.has(origin.hostname)) {
      ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'must use https unless it is loopback' });
    }
    if (env.SESSION_IDLE_SECONDS > env.SESSION_ABSOLUTE_SECONDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_IDLE_SECONDS'],
        message: 'must not exceed SESSION_ABSOLUTE_SECONDS',
      });
    }
  })
  .transform((env) => ({ ...env, COOKIE_SECURE: new URL(env.APP_ORIGIN).protocol === 'https:' }));

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
