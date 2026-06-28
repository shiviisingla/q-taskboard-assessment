"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, getToken, getStoredUser } from "@/lib/api-client";
import { Header } from "@/components/Header";
import { StatusColumn } from "@/components/StatusColumn";
import { TaskDetail } from "@/components/TaskDetail";
import { ActivityFeed } from "@/components/ActivityFeed";
import type { ApiProjectDetail, ApiTask, TaskStatus, Role } from "@/types";
import { STATUS_ORDER } from "@/types";

type ExportResponse = {
  ok: boolean;
  exported: number;
  skipped: number;
  errors: Array<{ taskId: string; message: string }>;
  message: string;
};

type PageProps = { params: Promise<{ id: string }> };

export default function ProjectPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);
  const queryClient = useQueryClient();

  const [activeTask, setActiveTask] = useState<ApiTask | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newColumn, setNewColumn] = useState<TaskStatus>("todo");
  const [error, setError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
  }, [router]);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["project", id],
    queryFn: () => apiFetch<{ project: ApiProjectDetail }>(`/api/projects/${id}`),
  });

  const createTask = useMutation({
    mutationFn: (input: { title: string; status: TaskStatus }) =>
      apiFetch<{ task: ApiTask }>(`/api/projects/${id}/tasks`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      setNewTitle("");
      queryClient.invalidateQueries({ queryKey: ["project", id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "create failed"),
  });

  const exportTasks = useMutation({
    mutationFn: () =>
      apiFetch<ExportResponse>(`/api/projects/${id}/export`, { method: "POST" }),
    onSuccess: (data) => {
      setExportStatus(data.message);
      setTimeout(() => setExportStatus(null), 5000);
    },
    onError: (err) =>
      setExportStatus(
        `export failed: ${err instanceof Error ? err.message : "unknown error"}`
      ),
  });

  const project = data?.project;

  // Determine current user's role in this project for auth-aware UI
  const storedUser = getStoredUser();
  const currentUserRole: Role =
    project?.memberships.find((m) => m.user.id === storedUser?.id)?.role ?? "viewer";

  const tasksByStatus: Record<TaskStatus, ApiTask[]> = {
    todo: [],
    in_progress: [],
    review: [],
    done: [],
  };
  if (project) {
    for (const t of project.tasks) {
      tasksByStatus[t.status].push(t);
    }
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-7xl mx-auto px-6 py-8">
        <Link
          href="/dashboard"
          className="text-sm text-muted hover:text-white"
        >
          ← all projects
        </Link>

        {isLoading && <p className="text-muted text-sm mt-6">loading…</p>}
        {queryError && (
          <p className="text-sm text-red-400 mt-6">
            {queryError instanceof Error ? queryError.message : "failed to load"}
          </p>
        )}

        {project && (
          <>
            <div className="flex items-start justify-between mt-4 mb-8">
              <div>
                <h1 className="text-2xl font-semibold">{project.name}</h1>
                {project.description && (
                  <p className="text-sm text-muted mt-1 max-w-2xl">
                    {project.description}
                  </p>
                )}
                <p className="text-xs text-muted mt-2">
                  owner: {project.owner.name} · {project.memberships.length} members
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <button
                  onClick={() => exportTasks.mutate()}
                  disabled={exportTasks.isPending}
                  className="text-sm px-4 py-2 rounded-md border border-border hover:border-accent disabled:opacity-50 transition"
                >
                  {exportTasks.isPending ? "exporting…" : "export to airtable"}
                </button>
                {exportStatus && (
                  <p
                    className={`text-xs ${
                      exportStatus.startsWith("export failed")
                        ? "text-red-400"
                        : "text-green-400"
                    }`}
                  >
                    {exportStatus}
                  </p>
                )}
              </div>
            </div>

            <section className="bg-surface border border-border rounded-lg p-4 mb-6">
              <h2 className="text-sm font-medium mb-3">add a task</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTitle.trim()) return;
                  setError(null);
                  createTask.mutate({ title: newTitle.trim(), status: newColumn });
                }}
                className="flex gap-2"
              >
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="task title"
                  className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                />
                <select
                  value={newColumn}
                  onChange={(e) => setNewColumn(e.target.value as TaskStatus)}
                  className="rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none"
                >
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={createTask.isPending}
                  className="bg-accent hover:bg-indigo-500 text-white text-sm font-medium rounded-md px-4 disabled:opacity-50"
                >
                  add
                </button>
              </form>
              {error && (
                <p className="text-sm text-red-400 mt-2" role="alert">
                  {error}
                </p>
              )}
            </section>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {STATUS_ORDER.map((s) => (
                <StatusColumn
                  key={s}
                  status={s}
                  tasks={tasksByStatus[s]}
                  onTaskClick={setActiveTask}
                />
              ))}
            </div>

            <section className="mt-10">
              <h2 className="text-sm font-medium mb-3">members</h2>
              <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
                {project.memberships.map((m) => (
                  <li
                    key={m.id}
                    className="px-4 py-3 flex items-center justify-between text-sm"
                  >
                    <span>{m.user.name}</span>
                    <span className="text-xs text-muted">
                      {m.user.email} · {m.role}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <ActivityFeed projectId={id} />
          </>
        )}
      </main>

      {activeTask && project && (
        <TaskDetail
          task={activeTask}
          projectId={id}
          members={project.memberships}
          currentUserRole={currentUserRole}
          onClose={() => setActiveTask(null)}
        />
      )}
    </div>
  );
}
