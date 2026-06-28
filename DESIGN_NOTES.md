# Design Notes

## Activity Feed — Transactional Write Strategy

**Question:** If the activity write fails, should the original change roll back?

**Decision: Yes — use a single `prisma.$transaction` for both writes.**

The spec describes the feed as an "engagement audit trail", which means the audit record is part of the operation's correctness contract, not a nice-to-have side effect. A task that moves to `done` without leaving a trace is a corrupted audit trail — it's a worse outcome than the update failing cleanly. By wrapping both the primary write (task create/update, comment create) and the activity event insert in one transaction, either both succeed or neither does. The user sees an error and can retry; the DB stays consistent. The performance cost is negligible — one extra `INSERT` per user action, all within the same already-open DB connection.

The alternative (fire-and-forget: write the task first, then attempt the activity write) would mean partial failures silently produce gaps in the audit trail with no way to reconstruct what was missed. That's a harder operational problem than a retry-able transaction failure.

---

## SQL Injection Fix (Issue 1 from REVIEW.md)

**File:** `src/app/api/projects/[id]/tasks/route.ts`

Replaced `$queryRawUnsafe` with Prisma's `findMany` + `contains` filter. The search parameter is passed as a bound value to PostgreSQL, never interpolated into the SQL string. The fix also removes the branching — the same `findMany` call handles both the search and the no-search case via a conditional spread, keeping the code path uniform.

---

## Airtable Export — Idempotency Strategy

**File:** `src/lib/airtable-client.ts`

Each task is upserted rather than blindly created. Before writing, we search for an existing Airtable record whose `Name` field starts with the TaskBoard task ID. If found, we `update`; if not, we `create`. This means the export is safe to run multiple times — the record count in Airtable stays stable and each re-run refreshes stale data (e.g. a status that changed since the last export).

---

## Comment Thread — Append-Only Enforcement

**File:** `src/app/api/tasks/[id]/comments/route.ts`

The append-only constraint is enforced structurally: the route module exports only `GET` and `POST`. There is no `PUT`, `PATCH`, or `DELETE` handler. This means no amount of clever client-side calls can mutate or delete a comment — the server simply has no handler to dispatch to. The constraint is verified in the test suite by checking the route module's exports directly (`comments route — append-only invariant`).
