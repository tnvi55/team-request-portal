import { createControlClient, hashPassword, MembershipRole } from '@trp/database';
import { toTestUrl } from './test-app.js';

export const PASSWORD = 'correct horse battery staple';
export const ORG_ID = '0a7a5000-0000-4000-8000-0000000000a1';
export const DORMANT_ORG_ID = '0d0d0000-0000-4000-8000-0000000000d1';

/** Accounts used by the auth tests; each scenario has its own so tests stay independent. */
export const USERS = {
  employee: 'employee@atlas.test',
  mustChange: 'mustchange@atlas.test',
  disabledUser: 'disabled-user@atlas.test',
  disabledMember: 'disabled-member@atlas.test',
  toggle: 'toggle@atlas.test',
  changer: 'changer@atlas.test',
  dormant: 'member@dormant.test',
} as const;

export const migrationUrl = () => toTestUrl(process.env.CONTROL_MIGRATION_URL!);

/** Reset the control *_test database and load the accounts (as trp_migrator, the owner). */
export async function loadAuthFixture(): Promise<void> {
  const control = createControlClient(migrationUrl(), { max: 1 });
  try {
    const [row] = await control.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    const db = row?.db ?? '';
    if (!db.endsWith('_test')) throw new Error('fixture reset refused: not a _test database');
    await control.$executeRaw`TRUNCATE control_audit_events, memberships, tenant_directory, users, organizations`;
    await control.organization.create({ data: { id: ORG_ID, slug: 'atlas', name: 'Atlas Robotics' } });
    await control.organization.create({
      data: { id: DORMANT_ORG_ID, slug: 'dormant', name: 'Dormant Co', isActive: false },
    });
    const passwordHash = await hashPassword(PASSWORD);
    const make = async (
      email: string,
      opts: { orgId?: string; userActive?: boolean; memberActive?: boolean; mustChange?: boolean } = {},
    ) => {
      const user = await control.user.create({
        data: {
          normalizedEmail: email,
          displayName: email.split('@')[0]!,
          passwordHash,
          isActive: opts.userActive ?? true,
          mustChangePassword: opts.mustChange ?? false,
        },
      });
      await control.membership.create({
        data: {
          userId: user.id,
          organizationId: opts.orgId ?? ORG_ID,
          role: MembershipRole.EMPLOYEE,
          isActive: opts.memberActive ?? true,
        },
      });
    };
    await make(USERS.employee);
    await make(USERS.mustChange, { mustChange: true });
    await make(USERS.disabledUser, { userActive: false });
    await make(USERS.disabledMember, { memberActive: false });
    await make(USERS.toggle);
    await make(USERS.changer);
    await make(USERS.dormant, { orgId: DORMANT_ORG_ID });
  } finally {
    await control.$disconnect();
  }
}

/** Direct owner-role access for test setup and assertions. */
export async function withControl<T>(
  work: (c: ReturnType<typeof createControlClient>) => Promise<T>,
): Promise<T> {
  const control = createControlClient(migrationUrl(), { max: 1 });
  try {
    return await work(control);
  } finally {
    await control.$disconnect();
  }
}
