// pnpm db:seed — idempotent synthetic seed for local development databases.
// - Organizations, users, memberships, directory entries: created only if missing (never overwritten).
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
          displayName: `${org.name.split(' ')[0]} ${user.displayName}`,
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
          `${created} users created, ${inserted.requests} requests and ${inserted.events} audit events inserted`,
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
