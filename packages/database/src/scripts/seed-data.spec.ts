import { describe, expect, it } from 'vitest';
import { RequestStatus } from '../generated/tenant/enums.js';
import {
  ORGANIZATIONS,
  REQUESTS_PER_ORGANIZATION,
  USERS,
  deterministicUuid,
  planRequests,
} from './seed-data.js';

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

describe('seed people and projects', () => {
  it('gives every company several projects, each managed by a MANAGER', () => {
    for (const org of ORGANIZATIONS) {
      expect(org.projects.length).toBeGreaterThanOrEqual(2);
      const managers = new Set(org.projects.map((p) => p.managerKey));
      expect(managers.size).toBe(org.projects.length); // a different manager per project
      for (const key of managers) {
        expect(USERS.find((u) => u.key === key)?.role).toBe('MANAGER');
      }
    }
  });

  it('assigns employees only to projects of their own company, with unique real names', () => {
    for (const org of ORGANIZATIONS) {
      const projectNames = new Set(org.projects.map((p) => p.name));
      for (const user of USERS) {
        const person = org.people[user.key];
        if (person.project) expect(projectNames.has(person.project)).toBe(true);
        if (user.role === 'EMPLOYEE') expect(person.project).not.toBeNull();
        expect(person.jobTitle.length).toBeGreaterThanOrEqual(2);
      }
    }
    const names = ORGANIZATIONS.flatMap((o) => USERS.map((u) => o.people[u.key].displayName));
    expect(new Set(names).size).toBe(names.length);
  });
});
