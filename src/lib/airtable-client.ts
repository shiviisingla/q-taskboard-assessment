/**
 * Real Airtable client for production use.
 *
 * Wraps the official `airtable` npm package and adds:
 *   - Idempotent upsert: looks up by "Task ID" embedded in Name field before
 *     creating/updating, so repeated exports never create duplicates
 *   - Retry logic: up to 3 attempts with exponential backoff for transient
 *     errors (rate-limit 429, network failures, 5xx)
 *   - No retry on permanent failures (4xx except 429)
 *   - Per-record error isolation: a single failing record never aborts the export
 *
 * Table schema (matches the default Airtable "ajackus" table):
 *   Name        — singleLineText  — "{taskId} | {title}"
 *   Notes       — multilineText   — description + assignee + project
 *   Status      — singleSelect    — auto-extended via typecast (see upsertTask)
 *                                   values: "Todo" | "In progress" | "In review" | "Done"
 */

import Airtable from "airtable";
import type { FieldSet, Record as AirtableRecord } from "airtable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskFields = {
  Name: string;
  Notes: string;
  Status: string;
};

export type ExportResult = {
  exported: number;
  skipped: number;
  errors: Array<{ taskId: string; message: string }>;
};

export type TaskInput = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assigneeName: string | null;
  projectId: string;
};

// ---------------------------------------------------------------------------
// Map internal status → Airtable single-select label
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  todo: "Todo",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

function mapStatus(s: string): string {
  return STATUS_MAP[s] ?? "Todo";
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as Error & { statusCode?: number }).statusCode;
    if (code !== undefined) return RETRYABLE_STATUS_CODES.has(code);
    // No statusCode → likely a network-level error — retry
    return true;
  }
  return false;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err; // permanent (e.g. 422) — don't retry
      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY_MS * 2 ** attempt; // 500ms → 1s → 2s
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

function getTable() {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tableName = process.env.AIRTABLE_TABLE_NAME;

  if (!apiKey || !baseId || !tableName) {
    throw new Error(
      "Missing Airtable config. Set AIRTABLE_API_KEY, AIRTABLE_BASE_ID, and AIRTABLE_TABLE_NAME."
    );
  }

  const base = new Airtable({ apiKey }).base(baseId);
  return base<TaskFields>(tableName);
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/**
 * Delete any rows in the table that have an empty Name field.
 * Airtable default tables ship with a few blank placeholder rows — this
 * removes them before exporting so the result is clean.
 */
async function deleteEmptyRows(table: ReturnType<typeof getTable>): Promise<void> {
  return withRetry(async () => {
    const emptyRecords = await table
      .select({ filterByFormula: `{Name} = ""`, fields: ["Name"] })
      .firstPage();

    if (emptyRecords.length === 0) return;

    // Airtable destroy accepts up to 10 IDs at a time
    const ids = emptyRecords.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 10) {
      await table.destroy(ids.slice(i, i + 10) as [string, ...string[]]);
    }
  });
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Search for an existing Airtable record whose Name starts with the task ID.
 * Returns the Airtable record ID (recXXX) or null if not found.
 */
async function findByTaskId(
  table: ReturnType<typeof getTable>,
  taskId: string
): Promise<string | null> {
  return withRetry(async () => {
    const records: AirtableRecord<TaskFields>[] = await table
      .select({
        filterByFormula: `FIND("${taskId}", {Name}) = 1`,
        maxRecords: 1,
        fields: ["Name"],
      })
      .firstPage();
    return records.length > 0 ? records[0].id : null;
  });
}

/**
 * Upsert a single task into Airtable.
 * If a record with the same Task ID prefix exists, update it.
 * Otherwise create a new record.
 */
async function upsertTask(
  table: ReturnType<typeof getTable>,
  task: TaskInput
): Promise<void> {
  const existingId = await findByTaskId(table, task.id);

  const fields: TaskFields = {
    // Prefix Name with the task ID so we can look it up on re-export
    Name: `${task.id} | ${task.title}`,
    Notes: [
      task.description ?? "",
      `Assignee: ${task.assigneeName ?? "unassigned"}`,
      `Project: ${task.projectId}`,
    ]
      .filter(Boolean)
      .join("\n"),
    Status: mapStatus(task.status),
  };

  if (existingId) {
    await withRetry(() =>
      // typecast: true — Airtable will auto-create any new single-select
      // option that doesn't exist yet (e.g. "In review")
      table.update(existingId, fields as unknown as Partial<FieldSet>, { typecast: true })
    );
  } else {
    await withRetry(() =>
      table.create(fields as unknown as FieldSet, { typecast: true })
    );
  }
}

// ---------------------------------------------------------------------------
// Public export function
// ---------------------------------------------------------------------------

/**
 * Export an array of tasks to Airtable.
 *
 * Each task is upserted individually. If one task fails after all retries,
 * it is recorded in the errors array and the export continues with the rest.
 *
 * @returns ExportResult with counts of exported, skipped, and errors.
 */
export async function exportTasksToAirtable(tasks: TaskInput[]): Promise<ExportResult> {
  const table = getTable();
  const result: ExportResult = { exported: 0, skipped: 0, errors: [] };

  // Remove any blank placeholder rows before writing task data
  await deleteEmptyRows(table);

  for (const task of tasks) {
    try {
      await upsertTask(table, task);
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
