import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getCurrentUser,
  unauthorized,
  forbidden,
  notFound,
  getProjectMembership,
} from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/projects/:id/activity
 *
 * Returns recent activity for a project, most-recent first.
 * Any project member (including viewers) can read.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return notFound("project not found");

  const membership = await getProjectMembership(user.id, projectId);
  if (!membership) return forbidden("you are not a member of this project");

  const limit = Math.min(
    Number(req.nextUrl.searchParams.get("limit") ?? "50"),
    200
  );

  const events = await prisma.activityEvent.findMany({
    where: { projectId },
    include: {
      actor: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ events });
}
