// pnpm db:migrate:all [--test]
// Applies committed migrations: control first, then the SAME tenant history to every shard.
// Stops at the first failure and says which database failed, so a partial rollout is visible.
// Uses `migrate deploy` only: it never generates, resets, or drops anything.
import { ShardKey } from '../generated/control/enums.js';
import { assertLocal, databaseName, loadRootEnv, runPrisma, targetFromArgs, targets } from './support.js';

loadRootEnv();
const target = targetFromArgs();
const urls = targets(target);

const steps = [
  {
    label: 'control',
    config: 'prisma/control/prisma.config.ts',
    env: { CONTROL_MIGRATION_URL: urls.control.migration },
  },
  ...Object.values(ShardKey).map((key) => ({
    label: key,
    config: 'prisma/tenant/prisma.config.ts',
    env: { TENANT_MIGRATION_URL: urls.shards[key].migration },
  })),
];

for (const step of steps) {
  const url = Object.values(step.env)[0] as string;
  assertLocal(url);
  console.log(`\n== ${step.label} (${databaseName(url)})`);
  if (!runPrisma(['migrate', 'deploy', '--config', step.config], step.env)) {
    console.error(`\nMigration failed on ${step.label}. Later databases were NOT migrated.`);
    process.exit(1);
  }
}
console.log(`\nAll ${steps.length} databases migrated (${target}). Run pnpm db:verify to compare histories.`);
