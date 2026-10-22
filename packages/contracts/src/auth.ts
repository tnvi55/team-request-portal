import { z } from 'zod';

/** Password policy (plan.md / OWASP): length only, any characters, spaces and Unicode allowed. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const MEMBERSHIP_ROLES = ['ADMIN', 'MANAGER', 'EMPLOYEE'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/**
 * POST /api/v1/auth/login. Strict: unknown fields are rejected.
 * Login checks only lengths (a bounded password keeps Argon2 work bounded); the policy is
 * enforced when a password is set, so login never reveals which rule a stored password breaks.
 */
export const LoginRequestSchema = z.strictObject({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/** POST /api/v1/auth/change-password */
export const ChangePasswordRequestSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `must be at least ${PASSWORD_MIN_LENGTH} characters`)
      .max(PASSWORD_MAX_LENGTH, `must be at most ${PASSWORD_MAX_LENGTH} characters`),
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ['newPassword'],
    message: 'must differ from the current password',
  });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/** GET /api/v1/auth/csrf */
export interface CsrfResponse {
  csrfToken: string;
}

/** GET /api/v1/auth/me and the body of a successful login. */
export interface MeResponse {
  user: { id: string; email: string; displayName: string };
  organization: { id: string; slug: string; name: string };
  role: MembershipRole;
  mustChangePassword: boolean;
}
