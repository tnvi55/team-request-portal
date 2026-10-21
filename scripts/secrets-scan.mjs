// pnpm secrets:scan — scan the whole Git history for committed secrets with a pinned,
// locally run gitleaks container. Node wrapper so the volume path works in any shell.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const image = 'zricethezav/gitleaks:v8.30.1';
const result = spawnSync(
  'docker',
  ['run', '--rm', '-v', `${root}:/repo:ro`, image, 'git', '/repo', '--redact', '--no-banner'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
