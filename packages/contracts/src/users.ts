import { z } from 'zod';
import { MEMBERSHIP_ROLES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type MembershipRole } from './auth.js';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from './requests.js';

/** GET /api/v1/admin/users query string. */
export const UserListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

/**
 * POST /api/v1/admin/users. The organization is always the admin's own (from the session),
 * so the body has no organization field and rejects one. The temporary password is hashed
 * and never stored or returned; the new user must change it at first sign-in.
 */
export const CreateUserSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(MEMBERSHIP_ROLES),
  temporaryPassword: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`),
});
export type CreateUserBody = z.infer<typeof CreateUserSchema>;

/** PATCH /api/v1/admin/users/:membershipId. At least one change. */
export const UpdateMembershipSchema = z
  .strictObject({
    role: z.enum(MEMBERSHIP_ROLES).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.isActive !== undefined, {
    message: 'role or isActive is required',
  });
export type UpdateMembershipBody = z.infer<typeof UpdateMembershipSchema>;

/** Path parameter for /admin/users/:membershipId. */
export const MembershipIdSchema = z.uuid();

/** One member of the admin's company. Never includes password data. */
export interface CompanyUser {
  membershipId: string;
  user: { id: string; email: string; displayName: string };
  role: MembershipRole;
  /** False when either the membership or the identity is disabled. */
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}
