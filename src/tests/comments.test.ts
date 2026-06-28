/**
 * Tests for the comment thread feature.
 *
 * These tests exercise the business rules directly without hitting the
 * network. We model the authorization and append-only invariants using
 * the same helper functions used by the real API routes.
 */

import { describe, it, expect } from "vitest";
import { canPostComments } from "@/lib/auth";
import type { ProjectRole } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Authorization rules
// ---------------------------------------------------------------------------

describe("canPostComments", () => {
  it("allows admins to post", () => {
    expect(canPostComments("admin")).toBe(true);
  });

  it("allows members to post", () => {
    expect(canPostComments("member")).toBe(true);
  });

  it("blocks viewers from posting", () => {
    expect(canPostComments("viewer")).toBe(false);
  });

  it("blocks null role (non-member) from posting", () => {
    expect(canPostComments(null)).toBe(false);
  });

  it("blocks undefined role from posting", () => {
    expect(canPostComments(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Comment schema validation (mirrors server-side Zod schema)
// ---------------------------------------------------------------------------

import { z } from "zod";

const createCommentSchema = z.object({
  body: z.string().min(1, "comment cannot be empty").max(10000),
});

describe("comment schema", () => {
  it("accepts a valid comment body", () => {
    expect(createCommentSchema.safeParse({ body: "looks good to me" }).success).toBe(true);
  });

  it("rejects an empty body", () => {
    const result = createCommentSchema.safeParse({ body: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing body field", () => {
    const result = createCommentSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a body exceeding 10,000 characters", () => {
    const result = createCommentSchema.safeParse({ body: "x".repeat(10001) });
    expect(result.success).toBe(false);
  });

  it("accepts a body at exactly 10,000 characters", () => {
    const result = createCommentSchema.safeParse({ body: "x".repeat(10000) });
    expect(result.success).toBe(true);
  });

  it("rejects a non-string body", () => {
    expect(createCommentSchema.safeParse({ body: 42 }).success).toBe(false);
    expect(createCommentSchema.safeParse({ body: null }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Append-only invariant
//
// The API has no PUT, PATCH, or DELETE handler on the comments route.
// We verify this structurally by checking that the route module does not
// export those handlers.
// ---------------------------------------------------------------------------

import * as commentsRoute from "@/app/api/tasks/[id]/comments/route";

describe("comments route — append-only invariant", () => {
  it("exports GET (read)", () => {
    expect(typeof commentsRoute.GET).toBe("function");
  });

  it("exports POST (create)", () => {
    expect(typeof commentsRoute.POST).toBe("function");
  });

  it("does NOT export PUT", () => {
    expect((commentsRoute as Record<string, unknown>).PUT).toBeUndefined();
  });

  it("does NOT export PATCH", () => {
    expect((commentsRoute as Record<string, unknown>).PATCH).toBeUndefined();
  });

  it("does NOT export DELETE", () => {
    expect((commentsRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Chronological ordering simulation
// ---------------------------------------------------------------------------

type Comment = { id: string; body: string; createdAt: Date };

function sortChronologically(comments: Comment[]): Comment[] {
  return [...comments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

describe("comment ordering", () => {
  it("sorts comments oldest-first", () => {
    const comments: Comment[] = [
      { id: "c3", body: "third", createdAt: new Date("2026-01-01T12:00:00Z") },
      { id: "c1", body: "first", createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "c2", body: "second", createdAt: new Date("2026-01-01T11:00:00Z") },
    ];
    const sorted = sortChronologically(comments);
    expect(sorted.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("preserves order when already sorted", () => {
    const comments: Comment[] = [
      { id: "c1", body: "first", createdAt: new Date("2026-01-01T10:00:00Z") },
      { id: "c2", body: "second", createdAt: new Date("2026-01-01T11:00:00Z") },
    ];
    const sorted = sortChronologically(comments);
    expect(sorted.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("returns empty array for no comments", () => {
    expect(sortChronologically([])).toEqual([]);
  });
});
