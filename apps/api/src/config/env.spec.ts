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

  it('reports every missing variable at once', () => {
    expect(() => parseEnv({})).toThrow(/CONTROL_DATABASE_URL[\s\S]*REDIS_URL/);
  });
});
