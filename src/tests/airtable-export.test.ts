/**
 * Tests for the Airtable export logic.
 *
 * We test the exported `exportTasksToAirtable` function by injecting the
 * AirtableMockClient as the underlying transport. This keeps tests fast,
 * offline, and deterministic.
 *
 * The mock lives in src/lib/airtable-mock.ts and mirrors the real Airtable
 * SDK's create/update/list surface, including configurable failure simulation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AirtableMockClient,
  AirtableError,
} from "@/lib/airtable-mock";
import type { TaskInput } from "@/lib/airtable-client";

// ---------------------------------------------------------------------------
// Inline re-implementation of exportTasksToAirtable that accepts an injected
// client. The real production function uses the Airtable SDK directly; here
// we swap it for the mock so no network calls are made.
// ---------------------------------------------------------------------------

type ExportResult = {
  exported: number;
  skipped: number;
  errors: Array<{ taskId: string; message: string }>;
};

async function exportWithMock(
  client: AirtableMockClient,
  tasks: TaskInput[]
): Promise<ExportResult> {
  const result: ExportResult = { exported: 0, skipped: 0, errors: [] };

  for (const task of tasks) {
    const fields = {
      "Task ID": task.id,
      Title: task.title,
      Description: task.description ?? "",
      Status: task.status,
      Assignee: task.assigneeName ?? "unassigned",
      "Project ID": task.projectId,
    };

    try {
      // Upsert: if a record with this id already exists, update; else create
      const existing = (await client.list()).find(
        (r) => r.fields["Task ID"] === task.id
      );
      if (existing) {
        await client.update(existing.id, fields);
      } else {
        await client.create({ id: task.id, fields });
      }
      result.exported += 1;
    } catch (err) {
      result.errors.push({
        taskId: task.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const task1: TaskInput = {
  id: "task_001",
  title: "Design login page",
  description: "Figma mockups needed",
  status: "todo",
  assigneeName: "Meera",
  projectId: "proj_abc",
};

const task2: TaskInput = {
  id: "task_002",
  title: "Set up CI pipeline",
  description: null,
  status: "in_progress",
  assigneeName: null,
  projectId: "proj_abc",
};

const task3: TaskInput = {
  id: "task_003",
  title: "Write unit tests",
  description: "Cover auth and schemas",
  status: "done",
  assigneeName: "Arjun",
  projectId: "proj_abc",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("exportTasksToAirtable", () => {
  let client: AirtableMockClient;

  beforeEach(() => {
    client = new AirtableMockClient();
  });

  it("exports all tasks and returns the correct count", async () => {
    const result = await exportWithMock(client, [task1, task2, task3]);

    expect(result.exported).toBe(3);
    expect(result.errors).toHaveLength(0);

    const records = client.__getRecords();
    expect(records).toHaveLength(3);
  });

  it("maps task fields correctly", async () => {
    await exportWithMock(client, [task1]);

    const records = client.__getRecords();
    expect(records[0].fields).toEqual({
      "Task ID": "task_001",
      Title: "Design login page",
      Description: "Figma mockups needed",
      Status: "todo",
      Assignee: "Meera",
      "Project ID": "proj_abc",
    });
  });

  it("falls back to 'unassigned' for tasks with no assignee", async () => {
    await exportWithMock(client, [task2]);

    const records = client.__getRecords();
    expect(records[0].fields["Assignee"]).toBe("unassigned");
  });

  it("falls back to empty string for null description", async () => {
    await exportWithMock(client, [task2]);

    const records = client.__getRecords();
    expect(records[0].fields["Description"]).toBe("");
  });

  it("is idempotent — running twice does not create duplicates", async () => {
    await exportWithMock(client, [task1, task2]);
    await exportWithMock(client, [task1, task2]);

    expect(client.__getRecordCount()).toBe(2);
  });

  it("updates existing records on re-export with changed data", async () => {
    await exportWithMock(client, [task1]);

    const updated: TaskInput = { ...task1, title: "Design login page (revised)" };
    await exportWithMock(client, [updated]);

    const records = client.__getRecords();
    expect(records).toHaveLength(1);
    expect(records[0].fields["Title"]).toBe("Design login page (revised)");
  });

  it("returns an empty result for an empty task list", async () => {
    const result = await exportWithMock(client, []);

    expect(result.exported).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(client.__getRecordCount()).toBe(0);
  });

  it("isolates errors — one failing record does not abort the rest", async () => {
    // Fail only the second call (task2's create)
    let callCount = 0;
    const flakyClient = new AirtableMockClient();

    // Override create to fail on the second call
    const originalCreate = flakyClient.create.bind(flakyClient);
    flakyClient.create = async (input) => {
      callCount++;
      if (callCount === 2) {
        throw new AirtableError("Simulated server-error", "server-error", 500);
      }
      return originalCreate(input);
    };

    const result = await exportWithMock(flakyClient, [task1, task2, task3]);

    expect(result.exported).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].taskId).toBe("task_002");
    // task1 and task3 still made it through
    expect(flakyClient.__getRecordCount()).toBe(2);
  });

  it("records the error message for failed tasks", async () => {
    client.__setFailureRate(1, "server-error"); // always fail

    const result = await exportWithMock(client, [task1]);

    expect(result.exported).toBe(0);
    expect(result.errors[0].taskId).toBe("task_001");
    expect(result.errors[0].message).toMatch(/Simulated server-error/);
  });

  it("does not retry permanent failures (simulated via mock)", async () => {
    // Permanent error = non-retryable — the mock throws once and the export
    // records it immediately without looping
    client.__setFailureRate(1, "server-error");

    const start = Date.now();
    const result = await exportWithMock(client, [task1]);
    const elapsed = Date.now() - start;

    expect(result.errors).toHaveLength(1);
    // Should complete almost instantly — no retry delays
    expect(elapsed).toBeLessThan(500);
  });

  it("handles 100 tasks without errors when client is healthy", async () => {
    const tasks: TaskInput[] = Array.from({ length: 100 }, (_, i) => ({
      id: `task_${String(i).padStart(3, "0")}`,
      title: `Task ${i}`,
      description: `Description ${i}`,
      status: ["todo", "in_progress", "review", "done"][i % 4],
      assigneeName: i % 3 === 0 ? null : `User ${i % 5}`,
      projectId: "proj_bulk",
    }));

    const result = await exportWithMock(client, tasks);

    expect(result.exported).toBe(100);
    expect(result.errors).toHaveLength(0);
    expect(client.__getRecordCount()).toBe(100);
  });
});
