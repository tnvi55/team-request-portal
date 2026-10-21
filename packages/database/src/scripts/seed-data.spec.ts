import { describe, expect, it } from 'vitest';
import { RequestStatus } from '../generated/tenant/enums.js';
import { REQUESTS_PER_ORGANIZATION, deterministicUuid, planRequests } from './seed-data.js';

describe('seed plan', () => {
  const plan = planRequests();

  it('has enough requests per organization to exercise pagination', () => {
    expect(REQUESTS_PER_ORGANIZATION).toBeGreaterThanOrEqual(60);
    expect(plan).toHaveLength(REQUESTS_PER_ORGANIZATION);
  });

  it('uses every status', () => {
    expect(new Set(plan.map((r) => r.status))).toEqual(
      new Set([RequestStatus.PENDING, RequestStatus.APPROVED, RequestStatus.REJECTED]),
    );
  });

  it('never plans a self-review and always comments a rejection', () => {
    for (const r of plan) {
      expect(r.reviewerKey).not.toBe(r.submitterKey);
      if (r.status === RequestStatus.REJECTED) expect(r.reviewComment?.length).toBeGreaterThanOrEqual(3);
      expect(r.reviewerKey === null).toBe(r.status === RequestStatus.PENDING);
    }
  });

  it('includes equal timestamps so pagination must tie-break on id', () => {
    const times = plan.map((r) => r.createdAt.getTime());
    expect(new Set(times).size).toBeLessThan(times.length);
  });

  it('is deterministic, which makes the seed idempotent', () => {
    expect(planRequests()).toEqual(plan);
    expect(deterministicUuid('atlas:request:1')).toBe(deterministicUuid('atlas:request:1'));
    expect(deterministicUuid('atlas:request:1')).not.toBe(deterministicUuid('cedar:request:1'));
  });

  it('produces valid version-8 UUIDs', () => {
    expect(deterministicUuid('x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
