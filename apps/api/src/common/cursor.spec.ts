import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, type CursorBinding } from './cursor.js';

const SECRET = 'x'.repeat(32);
const binding: CursorBinding = {
  endpoint: 'requests',
  tenantId: '0a7a5000-0000-4000-8000-000000000001',
  scope: 'company',
  filters: { status: 'PENDING', category: undefined },
};
const position = { at: '2026-09-01T09:00:00.000Z', id: '2a000000-0000-4000-8000-000000000001' };

describe('signed cursor', () => {
  it('round-trips the position for the same list', () => {
    expect(decodeCursor(SECRET, encodeCursor(SECRET, binding, position), binding)).toEqual(position);
  });

  it('treats an undefined filter the same as an absent one', () => {
    const cursor = encodeCursor(SECRET, binding, position);
    expect(decodeCursor(SECRET, cursor, { ...binding, filters: { status: 'PENDING' } })).toEqual(position);
  });

  it.each([
    ['another tenant', { ...binding, tenantId: '0cedab00-0000-4000-8000-000000000002' }],
    ['another scope', { ...binding, scope: 'mine:someone' }],
    ['another filter', { ...binding, filters: { status: 'APPROVED' } }],
    ['another endpoint', { ...binding, endpoint: 'audit' }],
  ])('rejects replay for %s', (_, other) => {
    const cursor = encodeCursor(SECRET, binding, position);
    expect(() => decodeCursor(SECRET, cursor, other)).toThrow('Invalid cursor');
  });

  it('rejects an edited payload, a wrong secret, and garbage', () => {
    const cursor = encodeCursor(SECRET, binding, position);
    const [data, signature] = cursor.split('.');
    const edited = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(data!, 'base64url').toString()), tenantId: 'x' }),
    ).toString('base64url');
    expect(() => decodeCursor(SECRET, `${edited}.${signature}`, binding)).toThrow('Invalid cursor');
    expect(() => decodeCursor('y'.repeat(32), cursor, binding)).toThrow('Invalid cursor');
    expect(() => decodeCursor(SECRET, 'not-a-cursor', binding)).toThrow('Invalid cursor');
    expect(() => decodeCursor(SECRET, `${cursor}.extra`, binding)).toThrow('Invalid cursor');
  });
});
