import { z } from 'zod';
import { MEMBERSHIP_ROLES, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type MembershipRole } from './auth.js';
import { JobTitleSchema, type PersonSummary, type ProjectRef } from './people.js';
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
  jobTitle: JobTitleSchema.optional(),
  /** A project of the admin's own company; checked by the API and by a composite foreign key. */
  projectId: z.uuid().nullable().optional(),
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
    /** null clears the designation / removes the person from their project. */
    jobTitle: JobTitleSchema.nullable().optional(),
    projectId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'at least one of role, isActive, jobTitle, projectId is required',
  });
export type UpdateMembershipBody = z.infer<typeof UpdateMembershipSchema>;

/** Path parameter for /admin/users/:membershipId. */
export const MembershipIdSchema = z.uuid();

/** One member of the admin's company. Never includes password data. */
export interface CompanyUser {
  membershipId: string;
  user: { id: string; email: string; displayName: string };
  role: MembershipRole;
  jobTitle: string | null;
  project: ProjectRef | null;
  /** The current project's manager (null without a project, or for the project's own manager). */
  manager: PersonSummary | null;
  /** False when either the membership or the identity is disabled. */
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}
