# Terminal Log — TaskBoard Assessment

Chronological record of every significant command run during this session.

---

## 1. Setup

```
$ docker-compose up --build -d
$ docker-compose exec web npm run db:seed
```

Seed output (abbreviated):
```
Seeding database...
Created 5 users
Created 3 projects
Created 12 tasks
Seed complete.
```

App running at http://localhost:3000

---

## 2. Initial Test Run

```
$ docker-compose exec web npm test -- --reporter=verbose
```

```
> taskboard@0.1.0 test
> vitest run --reporter=verbose

 RUN  v2.1.8 /app

 ✓ src/tests/TaskCard.test.tsx (3)
   ✓ <TaskCard /> (3)
     ✓ renders the task title and assignee
     ✓ falls back to 'unassigned' when there is no assignee
     ✓ invokes onClick with the task when clicked
 ✓ src/tests/auth.test.ts (2)
   ✓ jwt (2)
     ✓ round-trips a payload
     ✓ returns null for an invalid token
 ✓ src/tests/schemas.test.ts (7)
   ✓ auth schemas (3)
     ✓ accepts a well-formed register payload
     ✓ rejects short passwords
     ✓ rejects missing email on login
   ✓ task schemas (4)
     ✓ accepts a minimal create task payload
     ✓ rejects empty titles
     ✓ accepts a status update
     ✓ rejects unknown statuses

 Test Files  3 passed (3)
      Tests  12 passed (12)
   Duration  ~800ms
```

---

## 3. Bug Proof — SQL Injection (Issue 1 from REVIEW.md)

### 3a. Baseline — normal search (no injection)

```
$ curl -s "http://localhost:3000/api/projects/cmqxaa3n90006pajxqau3cczz/tasks?q=setup" \
  -H "Authorization: Bearer <TOKEN>"
```

Response:
```json
{"tasks":[]}
```

No tasks matched "setup" — clean baseline, API is responding correctly.

---

### 3b. Injection attempt — UNION SELECT to exfiltrate users table

**Vulnerable code** (`src/app/api/projects/[id]/tasks/route.ts`, lines 26–35 before fix):

```ts
const sql = `
  SELECT id, project_id, title, description, status, assignee_id, created_by_id, position, created_at, updated_at
  FROM tasks
  WHERE project_id = '${projectId}'
    AND (title ILIKE '%${q}%' OR description ILIKE '%${q}%')
  ORDER BY position ASC
`;
const tasks = await prisma.$queryRawUnsafe(sql);
```

The `q` parameter is interpolated directly into SQL with no escaping.

**Injection command:**

```
$ curl -s -G "http://localhost:3000/api/projects/cmqxaa3n90006pajxqau3cczz/tasks" \
  --data-urlencode "q=x') UNION SELECT id, NULL, email, password_hash, 'todo', NULL, id, 0, created_at, updated_at FROM users--" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response — all 5 users' credentials leaked:**

```json
{
  "tasks": [
    {
      "id": "cmqxaa3n70003pajxwsxbxjp0",
      "project_id": null,
      "title": "dev@example.com",
      "description": "$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y",
      "status": "todo",
      "assignee_id": null,
      "created_by_id": "cmqxaa3n70003pajxwsxbxjp0",
      "position": 0,
      "created_at": "2026-06-28T04:23:22.099Z",
      "updated_at": "2026-06-28T04:23:22.099Z"
    },
    {
      "id": "cmqxaa3n20000pajxpv2goxgv",
      "project_id": null,
      "title": "meera@taskboard.dev",
      "description": "$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y",
      ...
    },
    {
      "title": "arjun@taskboard.dev",
      "description": "$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y",
      ...
    },
    {
      "title": "lina@example.com",
      "description": "$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y",
      ...
    },
    {
      "title": "kavya@example.com",
      "description": "$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y",
      ...
    }
  ]
}
```

All 5 users' emails and bcrypt password hashes returned in the `title` and `description` fields of fabricated task rows.

---

### 3c. Fix applied

**`src/app/api/projects/[id]/tasks/route.ts`** — replaced `$queryRawUnsafe` with Prisma's type-safe `findMany` + `contains` filter:

```ts
// FIX: was using $queryRawUnsafe with string interpolation — replaced with
// Prisma's type-safe findMany + contains filter. User input is passed as a
// parameterized value and never concatenated into SQL.
const tasks = await prisma.task.findMany({
  where: {
    projectId,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  },
  include: {
    assignee: { select: { id: true, name: true, email: true } },
  },
  orderBy: [{ status: "asc" }, { position: "asc" }],
});
```

**Same injection command after fix:**

```
$ curl -s -G "http://localhost:3000/api/projects/cmqxaa3n90006pajxqau3cczz/tasks" \
  --data-urlencode "q=x') UNION SELECT id, NULL, email, password_hash, 'todo', NULL, id, 0, created_at, updated_at FROM users--" \
  -H "Authorization: Bearer <TOKEN>"
```

**Response — injection neutralised:**

```json
{"tasks":[]}
```

The entire injection string is treated as a plain text search term. No SQL executes. Empty result — correct.

---

## 4. Part 3c — Airtable Export Demo

### 4a. New files created

| File | Purpose |
|---|---|
| `src/lib/airtable-client.ts` | Real Airtable client with upsert, retry, per-record error isolation |
| `src/app/api/projects/[id]/export/route.ts` | `POST` endpoint — auth + role check, fetches tasks, calls export |
| `src/tests/airtable-export.test.ts` | 11 unit tests via mock client |
| `.env` | `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME` wired up |

UI: "export to airtable" button added to project detail page header (`src/app/projects/[id]/page.tsx`).

---

### 4b. First export run — 7 tasks from Q3 Launch

```
$ curl -s -X POST http://localhost:3000/api/projects/cmqxaa3n90006pajxqau3cczz/export \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool
```

```json
{
    "ok": true,
    "exported": 7,
    "skipped": 0,
    "errors": [],
    "message": "exported 7 tasks to Airtable"
}
```

---

### 4c. Airtable base — tasks visible

Airtable base URL: https://airtable.com/appjmfgczInQMFWYJ/tblR2pv9ZBGfKRbuq

Screenshot shows 7 tasks exported to the `ajackus` table with Name, Notes, and Status columns populated.
Status values: `Todo`, `In progress`, `In review`, `Done` — all four statuses present.

Note: `In review` status was auto-created via `typecast: true` on first write — no manual Airtable schema changes required.

---

### 4d. Second export run — idempotency proof

```
$ curl -s -X POST http://localhost:3000/api/projects/cmqxaa3n90006pajxqau3cczz/export \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool
```

```json
{
    "ok": true,
    "exported": 10,
    "skipped": 0,
    "errors": [],
    "message": "exported 10 tasks to Airtable"
}
```

(10 tasks by this point — 3 additional tasks had been added to the project via the UI between runs.)

Airtable record count remained stable — existing records were updated in-place, no duplicates created.
The upsert logic in `airtable-client.ts` queries by task ID prefix in the Name field before deciding whether to create or update.

---

### 4e. Viewer role blocked from export

```
$ TOKEN_VIEWER=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

$ curl -s -X POST http://localhost:3000/api/projects/cmqxaa3n90006pajxqau3cczz/export \
  -H "Authorization: Bearer $TOKEN_VIEWER" | python3 -m json.tool
```

```json
{
    "error": "viewers cannot export tasks"
}
```

HTTP 403 — role guard enforced correctly.

---

## 5. Final Test Run (after all changes)

```
$ docker-compose exec web npm test -- --reporter=verbose
```

```
> taskboard@0.1.0 test
> vitest run --reporter=verbose

The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.
 RUN  v2.1.8 /app

 ✓ src/tests/TaskCard.test.tsx (3)
   ✓ <TaskCard /> (3)
     ✓ renders the task title and assignee
     ✓ falls back to 'unassigned' when there is no assignee
     ✓ invokes onClick with the task when clicked
 ✓ src/tests/airtable-export.test.ts (11)
   ✓ exportTasksToAirtable (11)
     ✓ exports all tasks and returns the correct count
     ✓ maps task fields correctly
     ✓ falls back to 'unassigned' for tasks with no assignee
     ✓ falls back to empty string for null description
     ✓ is idempotent — running twice does not create duplicates
     ✓ updates existing records on re-export with changed data
     ✓ returns an empty result for an empty task list
     ✓ isolates errors — one failing record does not abort the rest
     ✓ records the error message for failed tasks
     ✓ does not retry permanent failures (simulated via mock)
     ✓ handles 100 tasks without errors when client is healthy
 ✓ src/tests/auth.test.ts (2)
   ✓ jwt (2)
     ✓ round-trips a payload
     ✓ returns null for an invalid token
 ✓ src/tests/schemas.test.ts (7)
   ✓ auth schemas (3)
     ✓ accepts a well-formed register payload
     ✓ rejects short passwords
     ✓ rejects missing email on login
   ✓ task schemas (4)
     ✓ accepts a minimal create task payload
     ✓ rejects empty titles
     ✓ accepts a status update
     ✓ rejects unknown statuses

 Test Files  4 passed (4)
      Tests  23 passed (23)
   Start at  05:21:45
   Duration  541ms (transform 103ms, setup 212ms, collect 212ms, tests 55ms, environment 723ms, prepare 301ms)
```

12 original tests all still pass. 11 new Airtable export tests added. Total: **23 passed, 0 failed**.


part 3c: airtelbase img: https://drive.google.com/file/d/10DD_OM43lkjOwq-I5TpddqNNM8ZjDtaL/view?usp=sharing
dashboard mg: https://drive.google.com/file/d/1RsOp5Tdd96IBXpbBSqw16XvB16nEwVIt/view?usp=sharing

part 2: https://drive.google.com/file/d/169MZoSolOK5-t4XB6fA-MrWClD-KgcKH/view?usp=sharing

part 3 a: https://drive.google.com/file/d/1ckSsYN5-CyFaYi47SD1wuvQTvM6aUspg/view?usp=sharing

part 3b: https://drive.google.com/file/d/1ppZU0j-PTadgmldloS3SvK1kTG59Ihi4/view?usp=sharing