import { describe, expect, it } from 'vitest';
import { parseEnv } from './env.js';

const validEnv = {
  APP_ORIGIN: 'http://localhost:8080',
  CONTROL_DATABASE_URL: 'postgres://user:pw@127.0.0.1:5433/trp_control',
  SHARD_A_DATABASE_URL: 'postgres://user:pw@127.0.0.1:5434/trp_shard_a',
  SHARD_B_DATABASE_URL: 'postgres://user:pw@127.0.0.1:5435/trp_shard_b',
  REDIS_URL: 'redis://:pw@127.0.0.1:6380',
  SESSION_SECRET: 's'.repeat(32),
  CURSOR_SECRET: 'c'.repeat(32),
};

describe('parseEnv', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const config = parseEnv(validEnv);
    expect(config.API_PORT).toBe(3001);
    expect(config.API_HOST).toBe('127.0.0.1');
    expect(config.NODE_ENV).toBe('development');
  });

  it('coerces the port from a string', () => {
    expect(parseEnv({ ...validEnv, API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('rejects a short secret without echoing its value', () => {
    const weak = 'tooShortSecretValue';
    expect(() => parseEnv({ ...validEnv, SESSION_SECRET: weak })).toThrow(/SESSION_SECRET/);
    try {
      parseEnv({ ...validEnv, SESSION_SECRET: weak });
    } catch (error) {
      expect((error as Error).message).not.toContain(weak);
    }
  });

  it('rejects a non-Postgres database URL', () => {
    expect(() => parseEnv({ ...validEnv, SHARD_B_DATABASE_URL: 'mysql://x' })).toThrow(
      /SHARD_B_DATABASE_URL/,
    );
  });

  it('uses non-Secure cookies only for loopback http and Secure cookies for https', () => {
    expect(parseEnv(validEnv).COOKIE_SECURE).toBe(false);
    expect(parseEnv({ ...validEnv, APP_ORIGIN: 'https://portal.example' }).COOKIE_SECURE).toBe(true);
  });

  it('refuses plain http on a non-loopback origin', () => {
    expect(() => parseEnv({ ...validEnv, APP_ORIGIN: 'http://portal.example' })).toThrow(/APP_ORIGIN/);
  });

  it('applies the planned session and limit defaults', () => {
    const config = parseEnv(validEnv);
    expect(config.SESSION_IDLE_SECONDS).toBe(1800);
    expect(config.SESSION_ABSOLUTE_SECONDS).toBe(28800);
    expect(config.LOGIN_LIMIT_PER_ACCOUNT).toBe(5);
    expect(config.LOGIN_LIMIT_PER_IP).toBe(30);
    expect(config.LIMIT_WINDOW_SECONDS).toBe(900);
  });

  it('applies the M7 cache, API limit, and observability defaults', () => {
    const config = parseEnv(validEnv);
    expect(config.DASHBOARD_CACHE_TTL_SECONDS).toBe(5);
    expect(config.API_LIMIT_PER_MINUTE).toBe(120);
    expect(config.EXPOSE_INSTANCE_ID).toBe(false); // demo-only header is off unless asked for
    expect(config.LOG_REQUESTS).toBe(true);
    expect(parseEnv({ ...validEnv, EXPOSE_INSTANCE_ID: 'true' }).EXPOSE_INSTANCE_ID).toBe(true);
    expect(() => parseEnv({ ...validEnv, EXPOSE_INSTANCE_ID: 'yes' })).toThrow(/EXPOSE_INSTANCE_ID/);
  });

  it('rejects an idle timeout longer than the absolute lifetime', () => {
    expect(() =>
      parseEnv({ ...validEnv, SESSION_IDLE_SECONDS: '600', SESSION_ABSOLUTE_SECONDS: '300' }),
    ).toThrow(/SESSION_IDLE_SECONDS/);
  });

  it('reports every missing variable at once', () => {
    expect(() => parseEnv({})).toThrow(/CONTROL_DATABASE_URL[\s\S]*REDIS_URL/);
  });
});
