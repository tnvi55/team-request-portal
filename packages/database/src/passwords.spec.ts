import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('password hashing', () => {
  it('produces an Argon2id hash with the OWASP baseline parameters', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(encoded.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(encoded).not.toContain('correct horse');
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const encoded = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(encoded, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(encoded, 'Correct horse battery staple')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password here')).not.toBe(await hashPassword('same password here'));
  });
});
