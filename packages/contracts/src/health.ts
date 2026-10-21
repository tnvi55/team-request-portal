/** Status of one required dependency. Never includes hostnames, URLs, or error text. */
export type DependencyStatus = 'up' | 'down';

export const READINESS_DEPENDENCIES = ['control', 'shardA', 'shardB', 'redis'] as const;
export type ReadinessDependency = (typeof READINESS_DEPENDENCIES)[number];

/** GET /api/v1/health/live */
export interface LivenessResponse {
  status: 'ok';
}

/** GET /api/v1/health/ready (HTTP 200 when ready, 503 when not) */
export interface ReadinessResponse {
  status: 'ready' | 'unready';
  checks: Record<ReadinessDependency, DependencyStatus>;
}
