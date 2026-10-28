// pnpm db:seed — idempotent synthetic seed for local development databases.
// - Organizations, users, memberships, directory entries, projects: created only if missing.
// - Profiles (designation, project) are filled only while still empty, and pre-M9 placeholder names
//   ("Atlas Manager") become real names once; later edits by an admin are never overwritten.
// - Requests and audit events: deterministic ids + skipDuplicates, so a second run inserts nothing.
// - Demo passwords: random, stored only in the Git-ignored .local/demo-credentials.json.
// Runs as trp_migrator. Tenant rows are written inside withTenant, so RLS checks every insert.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createControlClient, type ControlClient } from '../clients.js';
import { resolveShardKey } from '../directory.js';
import { RequestAuditAction, RequestStatus } from '../generated/tenant/enums.js';
import { hashPassword } from '../passwords.js';
import { ShardRegistry } from '../shard-registry.js';
import { withTenant } from '../tenant-transaction.js';
import {
  ORGANIZATIONS,
  USERS,
  deterministicUuid,
  planRequests,
  seedEmail,
  type SeedOrganization,
  type SeedUserKey,
} from './seed-data.js';
import { assertLocal, databaseName, loadRootEnv, repoRoot, targets } from './support.js';

type Credentials = Record<string, string>; // email -> password

const credentialsFile = resolve(repoRoot, '.local/demo-credentials.json');

function loadCredentials(): Credentials {
  return existsSync(credentialsFile)
    ? (JSON.parse(readFileSync(credentialsFile, 'utf8')) as Credentials)
    : {};
}

function saveCredentials(credentials: Credentials): void {
  mkdirSync(resolve(repoRoot, '.local'), { recursive: true });
  writeFileSync(credentialsFile, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
}

/** Control side of one organization. Returns userKey -> userId. */
async function seedControl(
  control: ControlClient,
  org: SeedOrganization,
  credentials: Credentials,
): Promise<{
  organizationId: string;
  userIds: Record<string, string>;
  created: number;
  missingPasswords: string[];
}> {
  let created = 0;
  const missingPasswords: string[] = [];

  const organization =
    (await control.organization.findUnique({ where: { slug: org.slug } })) ??
    (await control.organization.create({ data: { slug: org.slug, name: org.name } }));

  const directory = await control.tenantDirectory.findUnique({ where: { organizationId: organization.id } });
  if (!directory) {
    await control.tenantDirectory.create({
      data: { organizationId: organization.id, shardKey: org.shardKey },
    });
  } else if (directory.shardKey !== org.shardKey) {
    // Moving a tenant between shards is a data migration, never a silent seed side effect.
    throw new Error(
      `${org.slug} is mapped to ${directory.shardKey}, expected ${org.shardKey}. Not changing it.`,
    );
  }

  const userIds: Record<string, string> = {};
  for (const user of USERS) {
    const email = seedEmail(org.slug, user.key);
    const existing = await control.user.findUnique({ where: { normalizedEmail: email } });
    if (existing) {
      userIds[user.key] = existing.id;
      if (!credentials[email]) missingPasswords.push(email);
      continue;
    }
    const password = credentials[email] ?? randomBytes(15).toString('base64url'); // 20 characters
    credentials[email] = password;
    const passwordHash = await hashPassword(password);
    // Account creation = user + membership + audit event in ONE control transaction (plan rule).
    const newUser = await control.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          normalizedEmail: email,
          displayName: org.people[user.key].displayName,
          passwordHash,
        },
      });
      const membership = await tx.membership.create({
        data: { userId: u.id, organizationId: organization.id, role: user.role },
      });
      await tx.controlAuditEvent.create({
        data: {
          organizationId: organization.id,
          action: 'SEED_ACCOUNT_CREATED',
          targetId: membership.id,
          metadata: { role: user.role },
          requestId: 'seed',
        },
      });
      return u;
    });
    userIds[user.key] = newUser.id;
    created += 1;
  }
  return { organizationId: organization.id, userIds, created, missingPasswords };
}

/** Projects (each with its own manager) and seeded people's designations. Returns profiles changed. */
async function seedProfiles(
  control: ControlClient,
  org: SeedOrganization,
  organizationId: string,
  userIds: Record<string, string>,
): Promise<number> {
  const memberships = await control.membership.findMany({
    where: { organizationId, userId: { in: Object.values(userIds) } },
    include: { user: { select: { displayName: true } } },
  });
  const membershipOf = (key: SeedUserKey) => memberships.find((m) => m.userId === userIds[key])!;

  const projectIds: Record<string, string> = {};
  for (const project of org.projects) {
    const existing = await control.project.findUnique({
      where: { organizationId_name: { organizationId, name: project.name } },
    });
    projectIds[project.name] = (
      existing ??
      (await control.project.create({
        data: {
          organizationId,
          name: project.name,
          managerMembershipId: membershipOf(project.managerKey).id,
        },
      }))
    ).id;
  }

  let changed = 0;
  for (const user of USERS) {
    const person = org.people[user.key];
    const membership = membershipOf(user.key);
    const legacyName = `${org.name.split(' ')[0]} ${user.legacyName}`;
    if (membership.user.displayName === legacyName) {
      await control.user.update({
        where: { id: membership.userId },
        data: { displayName: person.displayName },
      });
    }
    if (membership.jobTitle === null) {
      await control.membership.update({
        where: { id: membership.id },
        data: {
          jobTitle: person.jobTitle,
          projectId: person.project ? projectIds[person.project]! : null,
        },
      });
    }
    if (membership.user.displayName === legacyName || membership.jobTitle === null) changed += 1;
  }
  return changed;
}

async function main(): Promise<void> {
  loadRootEnv();
  const urls = targets('dev');
  for (const url of [urls.control.migration, ...Object.values(urls.shards).map((s) => s.migration)]) {
    assertLocal(url);
  }

  const control = createControlClient(urls.control.migration, { max: 2 });
  const shards = new ShardRegistry(
    { SHARD_A: urls.shards.SHARD_A.migration, SHARD_B: urls.shards.SHARD_B.migration },
    { max: 2 },
  );
  const credentials = loadCredentials();
  const plan = planRequests();

  try {
    for (const org of ORGANIZATIONS) {
      const { organizationId, userIds, created, missingPasswords } = await seedControl(
        control,
        org,
        credentials,
      );
      const profiles = await seedProfiles(control, org, organizationId, userIds);
      // Route exactly as the API will: through the directory, never from the seed definition.
      const shardKey = await resolveShardKey(control, organizationId);

      const requests = plan.map((r) => ({
        tenantId: organizationId,
        id: deterministicUuid(`${org.slug}:request:${r.n}`),
        title: r.title,
        description: r.description,
        category: r.category,
        status: r.status,
        createdByUserId: userIds[r.submitterKey]!,
        reviewedByUserId: r.reviewerKey ? userIds[r.reviewerKey]! : null,
        reviewComment: r.reviewComment,
        createdAt: r.createdAt,
        updatedAt: r.reviewedAt ?? r.createdAt,
        reviewedAt: r.reviewedAt,
        version: r.status === RequestStatus.PENDING ? 0 : 1,
      }));
      const events = plan.flatMap((r) => {
        const requestId = deterministicUuid(`${org.slug}:request:${r.n}`);
        const createdEvent = {
          tenantId: organizationId,
          id: deterministicUuid(`${org.slug}:request:${r.n}:created`),
          requestId,
          actorUserId: userIds[r.submitterKey]!,
          action: RequestAuditAction.REQUEST_CREATED,
          occurredAt: r.createdAt,
          correlationRequestId: 'seed',
          metadata: { status: RequestStatus.PENDING },
        };
        if (!r.reviewerKey || !r.reviewedAt) return [createdEvent];
        return [
          createdEvent,
          {
            tenantId: organizationId,
            id: deterministicUuid(`${org.slug}:request:${r.n}:decided`),
            requestId,
            actorUserId: userIds[r.reviewerKey]!,
            action:
              r.status === RequestStatus.APPROVED
                ? RequestAuditAction.REQUEST_APPROVED
                : RequestAuditAction.REQUEST_REJECTED,
            occurredAt: r.reviewedAt,
            correlationRequestId: 'seed',
            metadata: { from: RequestStatus.PENDING, to: r.status },
          },
        ];
      });

      const inserted = await withTenant(shards.get(shardKey), organizationId, async (tx) => {
        const req = await tx.request.createMany({ data: requests, skipDuplicates: true });
        const ev = await tx.requestAuditEvent.createMany({ data: events, skipDuplicates: true });
        return { requests: req.count, events: ev.count };
      });

      console.log(
        `${org.slug.padEnd(6)} -> ${shardKey} (${databaseName(urls.shards[shardKey].migration)}): ` +
          `${created} users created, ${profiles} profiles updated, ${inserted.requests} requests and ${inserted.events} audit events inserted`,
      );
      if (missingPasswords.length > 0) {
        console.warn(
          `  note: ${missingPasswords.length} existing users have no password in the credentials file`,
        );
      }
    }
    saveCredentials(credentials);
    console.log(`\nDemo credentials: .local/demo-credentials.json (Git-ignored; never commit or share it).`);
  } finally {
    await Promise.allSettled([control.$disconnect(), shards.disconnectAll()]);
  }
}

await main();
