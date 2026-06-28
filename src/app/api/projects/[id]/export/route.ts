import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  getProjectMembership,
  canEditTasks,
} from "@/lib/auth";
import { exportTasksToAirtable } from "@/lib/airtable-client";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/export
 *
 * Exports all tasks for a project to Airtable.
 * Only admins and members can trigger the export; viewers are rejected.
 * The export is idempotent — running it multiple times upserts records,
 * it never creates duplicates.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) {
    return forbidden("viewers cannot export tasks");
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) return notFound("project not found");

  const tasks = await prisma.task.findMany({
    where: { projectId },
    include: {
      assignee: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { position: "asc" }],
  });

  if (tasks.length === 0) {
    return NextResponse.json({
      ok: true,
      exported: 0,
      skipped: 0,
      errors: [],
      message: "no tasks to export",
    });
  }

  const result = await exportTasksToAirtable(
    tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      assigneeName: t.assignee?.name ?? null,
      projectId: t.projectId,
    }))
  );

  const status = result.errors.length > 0 ? 207 : 200;
  return NextResponse.json(
    {
      ok: true,
      exported: result.exported,
      skipped: result.skipped,
      errors: result.errors,
      message:
        result.errors.length === 0
          ? `exported ${result.exported} tasks to Airtable`
          : `exported ${result.exported} tasks with ${result.errors.length} error(s)`,
    },
    { status }
  );
}
