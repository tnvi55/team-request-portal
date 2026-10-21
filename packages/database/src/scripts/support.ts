// Shared helpers for the local database scripts (migrate-all, seed, verify, test-prepare).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { ShardKey } from '../generated/control/enums.js';

export const packageRoot = resolve(import.meta.dirname, '../..');
export const repoRoot = resolve(packageRoot, '../..');

export function loadRootEnv(): void {
  const envFile = resolve(repoRoot, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run pnpm local:setup.`);
  return value;
}

/** Scripts that write data refuse any database that is not on this machine. */
export function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error('Refusing to run against a non-local database host.');
  }
}

/** Same server and credentials, isolated `<name>_test` database. */
export function toTestUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname}_test`;
  return parsed.toString();
}

/** Database name only, for messages (never print full URLs: they hold passwords). */
export function databaseName(url: string): string {
  return new URL(url).pathname.slice(1);
}

export type Target = 'dev' | 'test';

export interface DatabaseUrls {
  migration: string;
  runtime: string;
}

export interface Targets {
  control: DatabaseUrls;
  shards: Record<ShardKey, DatabaseUrls>;
}

export function targets(target: Target): Targets {
  const pick = (name: string) => (target === 'test' ? toTestUrl(requireEnv(name)) : requireEnv(name));
  return {
    control: { migration: pick('CONTROL_MIGRATION_URL'), runtime: pick('CONTROL_DATABASE_URL') },
    shards: {
      [ShardKey.SHARD_A]: { migration: pick('SHARD_A_MIGRATION_URL'), runtime: pick('SHARD_A_DATABASE_URL') },
      [ShardKey.SHARD_B]: { migration: pick('SHARD_B_MIGRATION_URL'), runtime: pick('SHARD_B_DATABASE_URL') },
    },
  };
}

export function targetFromArgs(): Target {
  return process.argv.includes('--test') ? 'test' : 'dev';
}

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');

/** Runs the Prisma CLI with node directly (no shell), so it behaves the same in every terminal. */
export function runPrisma(args: string[], env: Record<string, string>): boolean {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: packageRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return result.status === 0;
}
