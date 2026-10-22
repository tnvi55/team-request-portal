import { z } from 'zod';

export const REQUEST_CATEGORIES = ['EQUIPMENT', 'SOFTWARE', 'OTHER'] as const;
export type RequestCategory = (typeof REQUEST_CATEGORIES)[number];

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Whose requests a list or dashboard covers. Employees may only use "mine". */
export const REQUEST_SCOPES = ['mine', 'company'] as const;
export type RequestScope = (typeof REQUEST_SCOPES)[number];

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;

/**
 * POST /api/v1/requests. Strict: tenant, status, submitter, and version are server-owned,
 * so a body that tries to send them is rejected outright.
 */
export const CreateRequestSchema = z.strictObject({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(2000),
  category: z.enum(REQUEST_CATEGORIES),
});
export type CreateRequestBody = z.infer<typeof CreateRequestSchema>;

/** GET /api/v1/requests query string. */
export const ListRequestsQuerySchema = z.strictObject({
  scope: z.enum(REQUEST_SCOPES).optional(),
  status: z.enum(REQUEST_STATUSES).optional(),
  category: z.enum(REQUEST_CATEGORIES).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type ListRequestsQuery = z.infer<typeof ListRequestsQuerySchema>;

/** GET /api/v1/dashboard query string. */
export const DashboardQuerySchema = z.strictObject({
  scope: z.enum(REQUEST_SCOPES).optional(),
});
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

/** Path parameter for /requests/:id. */
export const RequestIdSchema = z.uuid();

export interface PersonRef {
  id: string;
  /** Null when the person is no longer a member of this organization. */
  displayName: string | null;
}

export interface RequestSummary {
  id: string;
  title: string;
  category: RequestCategory;
  status: RequestStatus;
  createdAt: string;
  createdBy: PersonRef;
}

export interface RequestDetail extends RequestSummary {
  description: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedBy: PersonRef | null;
  reviewComment: string | null;
  version: number;
}

/** Cursor page: no total count (that would cost an extra query per page). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DashboardResponse {
  scope: RequestScope;
  counts: Record<RequestStatus, number> & { total: number };
}
