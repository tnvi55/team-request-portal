-- M9: designations and projects. Generated with prisma migrate diff (ADR-014), plus the
-- hand-written CHECK constraints and runtime grant at the end.

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "job_title" VARCHAR(80),
ADD COLUMN     "project_id" UUID;

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "manager_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_manager_membership_id_idx" ON "projects"("manager_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_organization_id_key" ON "projects"("id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_organization_id_name_key" ON "projects"("organization_id", "name");

-- CreateIndex
CREATE INDEX "memberships_project_id_idx" ON "memberships"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_id_organization_id_key" ON "memberships"("id", "organization_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_membership_id_organization_id_fkey" FOREIGN KEY ("manager_membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: no blank or padded designations / project names.
ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_job_title_trimmed" CHECK ("job_title" IS NULL OR ("job_title" = btrim("job_title") AND length("job_title") >= 2));
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 2);

-- Runtime role: read-only. The API lists projects and assigns members to them (an UPDATE on
-- memberships, already granted); projects are created by operators/seed, so no INSERT/UPDATE here.
GRANT SELECT ON "projects" TO trp_runtime;
