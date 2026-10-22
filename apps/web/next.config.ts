import { resolve } from 'node:path';
import type { NextConfig } from 'next';

const repoRoot = resolve(import.meta.dirname, '../..');

const nextConfig: NextConfig = {
  // Self-contained server bundle for the production Docker image (identical in web-1 and web-2).
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages are included in the bundle.
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  poweredByHeader: false,
  reactStrictMode: true,
  // Pages are client-rendered shells, but never let a shared cache keep one (plan: private pages
  // use no-store). Hashed /_next/static assets keep their own long-lived caching.
  async headers() {
    return [{ source: '/((?!_next/static).*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] }];
  },
};

export default nextConfig;
