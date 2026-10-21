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
};

export default nextConfig;
