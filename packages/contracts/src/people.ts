import { z } from 'zod';

/** A designation such as "QA Engineer". Display only: permissions come from the role alone. */
export const JobTitleSchema = z.string().trim().min(2).max(80);

export interface ProjectRef {
  id: string;
  name: string;
}

/** A person as shown next to someone else's name. */
export interface PersonSummary {
  displayName: string;
  jobTitle: string | null;
}

/**
 * Where someone sits in their company: designation, current project, and that project's manager
 * (their current manager). A company can have many projects, each with its own manager.
 */
export interface MemberProfile {
  jobTitle: string | null;
  project: ProjectRef | null;
  /** The current project's manager; null without a project or when they manage it themselves. */
  manager: PersonSummary | null;
  /** Projects this person manages (managers usually; empty for most people). */
  managedProjects: ProjectRef[];
}

/** GET /api/v1/admin/projects: the admin's own company only. */
export interface ProjectSummary extends ProjectRef {
  manager: PersonSummary | null;
  memberCount: number;
}
