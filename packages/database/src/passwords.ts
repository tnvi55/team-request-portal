import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id with the OWASP baseline: 19 MiB memory, 2 iterations, 1 lane.
 * Benchmarked locally in M3 before tightening. Never log inputs or outputs.
 */
const ARGON2ID_OPTIONS = {
  algorithm: 2, // Algorithm.Argon2id (a const enum, which isolatedModules cannot import)
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}

export function verifyPassword(encodedHash: string, password: string): Promise<boolean> {
  return verify(encodedHash, password);
}
