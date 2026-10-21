import { resolve } from 'node:path';

// Same source as local development: the generated, Git-ignored repo-root .env.
process.loadEnvFile(resolve(import.meta.dirname, '../../../.env'));
