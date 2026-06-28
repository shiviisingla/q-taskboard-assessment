/**
 * Activity recording helpers.
 *
 * Design decision — transactional writes:
 * Each activity event is written inside the same Prisma transaction as the
 * original change (task create/update, comment create). If the activity write
 * fails, the original change rolls back. We chose this because the feature
 * spec treats the feed as an "engagement audit trail" — a change that leaves
 * no trace is worse than a change that fails cleanly. The performance overhead
 * is negligible (one extra INSERT per operation), and a single transaction
 * keeps the DB consistent without needing any dead-letter or retry mechanism.
 */

import { prisma } from "./prisma";
import { Prisma } from "@prisma/client";

export type ActivityType =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "comment_added";

export type ActivityMetadata = Record<string, unknown>;

type TransactionClient = Parameters<
  Parameters<typeof prisma.$transaction>[0]
>[0];

export type ActivityCreateOpts = {
  projectId: string;
  taskId?: string | null;
  actorId: string;
  type: ActivityType;
  metadata?: ActivityMetadata;
};

/**
 * Returns a Prisma operation to create an activity event.
 * Pass this inside a prisma.$transaction([...]) array alongside
 * the primary write so both succeed or both roll back together.
 *
 * @example
 * const [task] = await prisma.$transaction([
 *   prisma.task.create({ data: ... }),
 *   activityOp(tx, { projectId, taskId, actorId, type: "task_created" }),
 * ]);
 */
export function activityOp(
  tx: TransactionClient,
  opts: ActivityCreateOpts
): ReturnType<TransactionClient["activityEvent"]["create"]> {
  return tx.activityEvent.create({
    data: {
      projectId: opts.projectId,
      taskId: opts.taskId ?? null,
      actorId: opts.actorId,
      type: opts.type,
      metadata: (opts.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}
