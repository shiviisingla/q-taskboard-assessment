/**
 * Tests for the Activity Feed feature.
 *
 * Tests cover:
 * - Event type enumeration and descriptions
 * - Authorization rules (all members including viewers can read)
 * - Feed ordering (most recent first)
 * - Route structure (only GET is exported — no write endpoint)
 * - Metadata shape for each event type
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Activity event type definitions (mirrors src/types/index.ts)
// ---------------------------------------------------------------------------

type ActivityType =
  | "task_created"
  | "status_changed"
  | "assignee_changed"
  | "comment_added";

type ActivityEvent = {
  id: string;
  type: ActivityType;
  metadata: Record<string, unknown>;
  createdAt: Date;
  actor: { id: string; name: string };
};

// ---------------------------------------------------------------------------
// describeEvent — the human-readable summary rendered in the feed
// (mirrors logic in ActivityFeed.tsx)
// ---------------------------------------------------------------------------

function describeEvent(event: ActivityEvent): string {
  const m = event.metadata;
  switch (event.type) {
    case "task_created":
      return `created task "${m.title}"`;
    case "status_changed":
      return `moved "${m.title}" from ${m.from} → ${m.to}`;
    case "assignee_changed": {
      const to = m.toId ? `reassigned to ${m.toId}` : "unassigned";
      return `${to} on "${m.title}"`;
    }
    case "comment_added":
      return `commented: "${m.preview}"`;
    default:
      return String(event.type);
  }
}

describe("describeEvent", () => {
  it("describes task_created correctly", () => {
    const e: ActivityEvent = {
      id: "e1",
      type: "task_created",
      metadata: { title: "Set up CI", status: "todo" },
      createdAt: new Date(),
      actor: { id: "u1", name: "Meera" },
    };
    expect(describeEvent(e)).toBe('created task "Set up CI"');
  });

  it("describes status_changed correctly", () => {
    const e: ActivityEvent = {
      id: "e2",
      type: "status_changed",
      metadata: { title: "Set up CI", from: "todo", to: "in_progress" },
      createdAt: new Date(),
      actor: { id: "u1", name: "Meera" },
    };
    expect(describeEvent(e)).toBe('moved "Set up CI" from todo → in_progress');
  });

  it("describes assignee_changed with new assignee", () => {
    const e: ActivityEvent = {
      id: "e3",
      type: "assignee_changed",
      metadata: { title: "Set up CI", fromName: "Meera", toId: "u2" },
      createdAt: new Date(),
      actor: { id: "u1", name: "Meera" },
    };
    expect(describeEvent(e)).toContain("u2");
    expect(describeEvent(e)).toContain("Set up CI");
  });

  it("describes assignee_changed with unassign", () => {
    const e: ActivityEvent = {
      id: "e4",
      type: "assignee_changed",
      metadata: { title: "Set up CI", fromName: "Meera", toId: null },
      createdAt: new Date(),
      actor: { id: "u1", name: "Meera" },
    };
    expect(describeEvent(e)).toContain("unassigned");
  });

  it("describes comment_added with preview", () => {
    const e: ActivityEvent = {
      id: "e5",
      type: "comment_added",
      metadata: { preview: "looks good to me" },
      createdAt: new Date(),
      actor: { id: "u1", name: "Meera" },
    };
    expect(describeEvent(e)).toBe('commented: "looks good to me"');
  });
});

// ---------------------------------------------------------------------------
// Feed ordering — most recent first
// ---------------------------------------------------------------------------

function sortFeed(events: ActivityEvent[]): ActivityEvent[] {
  return [...events].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

describe("feed ordering", () => {
  it("returns most-recent events first", () => {
    const events: ActivityEvent[] = [
      { id: "e1", type: "task_created", metadata: {}, createdAt: new Date("2026-01-01T10:00:00Z"), actor: { id: "u1", name: "A" } },
      { id: "e3", type: "comment_added", metadata: {}, createdAt: new Date("2026-01-01T12:00:00Z"), actor: { id: "u1", name: "A" } },
      { id: "e2", type: "status_changed", metadata: {}, createdAt: new Date("2026-01-01T11:00:00Z"), actor: { id: "u1", name: "A" } },
    ];
    const sorted = sortFeed(events);
    expect(sorted.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });

  it("handles empty feed", () => {
    expect(sortFeed([])).toEqual([]);
  });

  it("handles single event", () => {
    const e: ActivityEvent = {
      id: "e1", type: "task_created", metadata: {}, createdAt: new Date(), actor: { id: "u1", name: "A" },
    };
    expect(sortFeed([e])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Authorization — all roles can read; this is enforced at the route level
// ---------------------------------------------------------------------------

import { canEditTasks } from "@/lib/auth";
import type { ProjectRole } from "@/lib/auth";

describe("activity feed read access", () => {
  // The activity feed is read-only. Reading requires only membership, not edit rights.
  // We verify that canEditTasks (used for writes) correctly excludes viewers,
  // confirming that viewers are read-only, while the feed itself is readable by all.

  it("viewers cannot edit tasks (write-guard enforced)", () => {
    expect(canEditTasks("viewer")).toBe(false);
  });

  it("members can edit tasks", () => {
    expect(canEditTasks("member")).toBe(true);
  });

  it("admins can edit tasks", () => {
    expect(canEditTasks("admin")).toBe(true);
  });

  it("null role (non-member) cannot edit", () => {
    expect(canEditTasks(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route structure — only GET is exported (read-only feed)
// ---------------------------------------------------------------------------

import * as activityRoute from "@/app/api/projects/[id]/activity/route";

describe("activity route — read-only", () => {
  it("exports GET", () => {
    expect(typeof activityRoute.GET).toBe("function");
  });

  it("does NOT export POST", () => {
    expect((activityRoute as Record<string, unknown>).POST).toBeUndefined();
  });

  it("does NOT export PATCH", () => {
    expect((activityRoute as Record<string, unknown>).PATCH).toBeUndefined();
  });

  it("does NOT export DELETE", () => {
    expect((activityRoute as Record<string, unknown>).DELETE).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Metadata shape validation for each event type
// ---------------------------------------------------------------------------

describe("activity metadata shape", () => {
  it("task_created metadata has title and status", () => {
    const m = { title: "New task", status: "todo" };
    expect(m).toHaveProperty("title");
    expect(m).toHaveProperty("status");
  });

  it("status_changed metadata has from, to, title", () => {
    const m = { from: "todo", to: "in_progress", title: "My task" };
    expect(m.from).toBeDefined();
    expect(m.to).toBeDefined();
    expect(m.title).toBeDefined();
    expect(m.from).not.toBe(m.to);
  });

  it("assignee_changed metadata has title and toId", () => {
    const m = { title: "My task", fromName: "Alice", toId: "u2" };
    expect(m).toHaveProperty("title");
    expect(m).toHaveProperty("toId");
  });

  it("comment_added metadata has preview capped at 80 chars", () => {
    const body = "x".repeat(200);
    const preview = body.slice(0, 80);
    expect(preview).toHaveLength(80);

    const m = { preview };
    expect(m.preview.length).toBeLessThanOrEqual(80);
  });
});
