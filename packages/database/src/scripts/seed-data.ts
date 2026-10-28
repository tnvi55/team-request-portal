// Synthetic demo data definitions. Deterministic: the same input always produces the same rows,
// which is what makes the seed idempotent (re-running inserts nothing new).
import { createHash } from 'node:crypto';
import { MembershipRole, ShardKey } from '../generated/control/enums.js';
import { RequestCategory, RequestStatus } from '../generated/tenant/enums.js';

export type SeedUserKey = 'admin' | 'manager' | 'manager2' | 'employee' | 'employee2';

export interface SeedUser {
  key: SeedUserKey;
  role: MembershipRole;
  /** Display name suffix used by seeds before M9 ("Atlas Manager"); such names are upgraded. */
  legacyName: string;
}

/** A seeded person's profile: a realistic name, designation, and current project. */
export interface SeedPerson {
  displayName: string;
  jobTitle: string;
  project: string | null;
}

export interface SeedOrganization {
  slug: string;
  name: string;
  shardKey: ShardKey;
  /** Each project has its own manager: a company can have several managers. */
  projects: { name: string; managerKey: SeedUserKey }[];
  people: Record<SeedUserKey, SeedPerson>;
}

// Atlas and Cedar share shard A (tests same-shard isolation); Birch alone on shard B (cross-shard routing).
export const ORGANIZATIONS: SeedOrganization[] = [
  {
    slug: 'atlas',
    name: 'Atlas Robotics',
    shardKey: ShardKey.SHARD_A,
    projects: [
      { name: 'Warehouse Arm v2', managerKey: 'manager' },
      { name: 'Vision Platform', managerKey: 'manager2' },
    ],
    people: {
      admin: { displayName: 'Meera Kapoor', jobTitle: 'Head of Operations', project: null },
      manager: { displayName: 'Arjun Rao', jobTitle: 'Engineering Manager', project: null },
      manager2: { displayName: 'Sofia Fernandes', jobTitle: 'Product Manager', project: null },
      employee: { displayName: 'Rohan Gupta', jobTitle: 'Robotics Engineer', project: 'Warehouse Arm v2' },
      employee2: { displayName: 'Neha Singh', jobTitle: 'QA Engineer', project: 'Vision Platform' },
    },
  },
  {
    slug: 'cedar',
    name: 'Cedar Health',
    shardKey: ShardKey.SHARD_A,
    projects: [
      { name: 'Patient Portal', managerKey: 'manager' },
      { name: 'Lab Integrations', managerKey: 'manager2' },
    ],
    people: {
      admin: { displayName: 'Kavya Nair', jobTitle: 'HR and Admin Lead', project: null },
      manager: { displayName: 'Vikram Menon', jobTitle: 'Delivery Manager', project: null },
      manager2: { displayName: 'Aisha Khan', jobTitle: 'Data Team Lead', project: null },
      employee: { displayName: 'Ishaan Bose', jobTitle: 'Frontend Developer', project: 'Patient Portal' },
      employee2: { displayName: 'Tara Joshi', jobTitle: 'Data Analyst', project: 'Lab Integrations' },
    },
  },
  {
    slug: 'birch',
    name: 'Birch Logistics',
    shardKey: ShardKey.SHARD_B,
    projects: [
      { name: 'Route Optimizer', managerKey: 'manager' },
      { name: 'Fleet Tracking', managerKey: 'manager2' },
    ],
    people: {
      admin: { displayName: "Daniel D'Souza", jobTitle: 'Operations Director', project: null },
      manager: { displayName: 'Priya Reddy', jobTitle: 'Project Manager', project: null },
      manager2: { displayName: 'Sameer Patel', jobTitle: 'Engineering Manager', project: null },
      employee: { displayName: 'Ananya Iyer', jobTitle: 'Backend Developer', project: 'Route Optimizer' },
      employee2: { displayName: 'Kabir Malhotra', jobTitle: 'Support Engineer', project: 'Fleet Tracking' },
    },
  },
];

export const USERS: SeedUser[] = [
  { key: 'admin', role: MembershipRole.ADMIN, legacyName: 'Admin' },
  { key: 'manager', role: MembershipRole.MANAGER, legacyName: 'Manager' },
  // A second manager: each project has its own manager.
  { key: 'manager2', role: MembershipRole.MANAGER, legacyName: 'Second Manager' },
  { key: 'employee', role: MembershipRole.EMPLOYEE, legacyName: 'Employee' },
  // A second employee so "cannot read a coworker's request" can be demonstrated.
  { key: 'employee2', role: MembershipRole.EMPLOYEE, legacyName: 'Second Employee' },
];

/** `.example` is a reserved domain: these addresses can never reach a real mailbox. */
export function seedEmail(orgSlug: string, userKey: string): string {
  return `${userKey}@${orgSlug}.example`;
}

export const REQUESTS_PER_ORGANIZATION = 64;

const ITEMS: { title: string; category: RequestCategory }[] = [
  { title: 'Monitor for workstation', category: RequestCategory.EQUIPMENT },
  { title: 'Laptop docking station', category: RequestCategory.EQUIPMENT },
  { title: 'Noise-cancelling headset', category: RequestCategory.EQUIPMENT },
  { title: 'Ergonomic chair', category: RequestCategory.EQUIPMENT },
  { title: 'IDE license renewal', category: RequestCategory.SOFTWARE },
  { title: 'Design tool seat', category: RequestCategory.SOFTWARE },
  { title: 'Database client license', category: RequestCategory.SOFTWARE },
  { title: 'Conference ticket', category: RequestCategory.OTHER },
];

/** RFC 9562 version-8 (custom) UUID derived from a stable name. */
export function deterministicUuid(name: string): string {
  const bytes = createHash('sha256').update(`trp-seed:${name}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface PlannedRequest {
  n: number;
  title: string;
  description: string;
  category: RequestCategory;
  status: RequestStatus;
  submitterKey: SeedUserKey;
  reviewerKey: SeedUserKey | null;
  reviewComment: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
}

const BASE_TIME = Date.parse('2026-09-01T09:00:00.000Z');
const HOUR = 3_600_000;

/**
 * Varied, deterministic requests: statuses rotate PENDING, PENDING, APPROVED, REJECTED;
 * submitters rotate through both employees, the manager, and the admin; every 10th request
 * shares its predecessor's timestamp so pagination tie-breaking (createdAt, id) is exercised.
 */
export function planRequests(): PlannedRequest[] {
  const submitters: SeedUserKey[] = ['employee', 'employee2', 'manager', 'admin'];
  return Array.from({ length: REQUESTS_PER_ORGANIZATION }, (_, i) => {
    const n = i + 1;
    const item = ITEMS[i % ITEMS.length]!;
    const submitterKey = submitters[i % submitters.length]!;
    const statusCycle = [
      RequestStatus.PENDING,
      RequestStatus.PENDING,
      RequestStatus.APPROVED,
      RequestStatus.REJECTED,
    ];
    const status = statusCycle[Math.floor(i / 4) % statusCycle.length]!;
    const slot = n % 10 === 0 ? n - 1 : n;
    const createdAt = new Date(BASE_TIME + slot * 5 * HOUR);
    const decided = status !== RequestStatus.PENDING;
    // Never self-review: the admin reviews the manager's requests, the manager reviews everyone else's.
    const reviewerKey = decided ? (submitterKey === 'manager' ? 'admin' : 'manager') : null;
    return {
      n,
      title: `${item.title} #${n}`,
      description: `Synthetic demo request ${n}: ${item.title.toLowerCase()} for daily work.`,
      category: item.category,
      status,
      submitterKey,
      reviewerKey,
      reviewComment:
        status === RequestStatus.REJECTED
          ? 'Not in this quarter budget.'
          : status === RequestStatus.APPROVED
            ? 'Approved.'
            : null,
      createdAt,
      reviewedAt: decided ? new Date(createdAt.getTime() + 2 * HOUR) : null,
    };
  });
}
