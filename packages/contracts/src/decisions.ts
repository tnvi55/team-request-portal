import { z } from 'zod';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, type PersonRef } from './requests.js';

export const DECISIONS = ['APPROVED', 'REJECTED'] as const;
export type Decision = (typeof DECISIONS)[number];

export const REVIEW_COMMENT_MIN = 3;
export const REVIEW_COMMENT_MAX = 500;

/**
 * POST /api/v1/requests/:id/decision.
 * expectedVersion is the version the reviewer saw: a stale or already-decided request is a 409.
 * A comment is optional when approving and required when rejecting (plan.md section 3).
 */
export const DecisionSchema = z
  .strictObject({
    decision: z.enum(DECISIONS),
    expectedVersion: z.number().int().min(0),
    comment: z.string().trim().min(REVIEW_COMMENT_MIN).max(REVIEW_COMMENT_MAX).optional(),
  })
  .refine((body) => body.decision !== 'REJECTED' || body.comment !== undefined, {
    path: ['comment'],
    message: `is required when rejecting (${REVIEW_COMMENT_MIN}-${REVIEW_COMMENT_MAX} characters)`,
  });
export type DecisionBody = z.infer<typeof DecisionSchema>;

/** GET /api/v1/admin/audit query string. */
export const AuditListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

export const AUDIT_ACTIONS = ['REQUEST_CREATED', 'REQUEST_APPROVED', 'REQUEST_REJECTED'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One request audit event. Metadata holds allowlisted state changes only. */
export interface AuditEvent {
  id: string;
  action: AuditAction;
  occurredAt: string;
  actor: PersonRef;
  request: { id: string; title: string };
  /** The HTTP request id that caused the event, for log correlation. */
  correlationRequestId: string | null;
  metadata: Record<string, string | number | boolean | null>;
}
