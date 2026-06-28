"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ApiActivity } from "@/types";

type Props = { projectId: string };

type ActivityResponse = { events: ApiActivity[] };

function formatDate(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const EVENT_ICONS: Record<ApiActivity["type"], string> = {
  task_created: "✦",
  status_changed: "⇄",
  assignee_changed: "◎",
  comment_added: "◆",
};

function describeEvent(event: ApiActivity): string {
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
      return event.type;
  }
}

export function ActivityFeed({ projectId }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () =>
      apiFetch<ActivityResponse>(`/api/projects/${projectId}/activity`),
    refetchInterval: 30_000, // poll every 30s
  });

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium mb-3">recent activity</h2>

      {isLoading && <p className="text-xs text-muted">loading…</p>}
      {error && (
        <p className="text-xs text-red-400">
          {error instanceof Error ? error.message : "failed to load activity"}
        </p>
      )}

      {data && data.events.length === 0 && (
        <p className="text-xs text-muted italic">no activity yet.</p>
      )}

      {data && data.events.length > 0 && (
        <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
          {data.events.map((e) => (
            <li
              key={e.id}
              className="px-4 py-3 flex items-start gap-3 text-sm"
            >
              <span className="text-xs text-accent mt-0.5 w-4 flex-shrink-0">
                {EVENT_ICONS[e.type] ?? "·"}
              </span>
              <div className="flex-1 min-w-0">
                <span className="font-medium">{e.actor.name}</span>
                <span className="text-muted"> {describeEvent(e)}</span>
              </div>
              <span className="text-xs text-muted flex-shrink-0 ml-2">
                {formatDate(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
