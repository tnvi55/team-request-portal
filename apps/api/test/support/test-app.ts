import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Type } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { APP_CONFIG, parseEnv, type AppConfig } from '../../src/config/env.js';

/** Same server and credentials, isolated `<name>_test` database (prepared by @trp/database). */
export function toTestUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_test`;
  return parsed.toString();
}

export const freshPrefix = () => `trp:test:${randomBytes(4).toString('hex')}:`;

/** Real config from .env, pointed at the *_test databases and a private Redis key prefix. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  const env = process.env;
  return parseEnv({
    ...env,
    NODE_ENV: 'test',
    CONTROL_DATABASE_URL: toTestUrl(env.CONTROL_DATABASE_URL!),
    SHARD_A_DATABASE_URL: toTestUrl(env.SHARD_A_DATABASE_URL!),
    SHARD_B_DATABASE_URL: toTestUrl(env.SHARD_B_DATABASE_URL!),
    REDIS_KEY_PREFIX: freshPrefix(),
    ...overrides,
  });
}

export interface TestApp {
  app: NestExpressApplication;
  config: AppConfig;
  agent: () => ReturnType<typeof request.agent>;
  close: () => Promise<void>;
}

export async function startApp(
  overrides: Record<string, string> = {},
  extraControllers: Type[] = [],
): Promise<TestApp> {
  const config = testConfig(overrides);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: extraControllers })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return {
    app,
    config,
    agent: () => request.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}
