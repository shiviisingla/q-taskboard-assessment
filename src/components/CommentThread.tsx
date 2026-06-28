"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ApiComment, Role } from "@/types";

type Props = {
  taskId: string;
  /** The current user's role in this project — controls whether the post form is shown. */
  currentUserRole: Role;
};

type CommentsResponse = { comments: ApiComment[] };
type PostResponse = { comment: ApiComment };

/** Format a timestamp as a relative or absolute string. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CommentThread({ taskId, currentUserRole }: Props) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [postError, setPostError] = useState<string | null>(null);
  const canPost = currentUserRole === "admin" || currentUserRole === "member";

  const { data, isLoading } = useQuery({
    queryKey: ["comments", taskId],
    queryFn: () => apiFetch<CommentsResponse>(`/api/tasks/${taskId}/comments`),
  });

  const postComment = useMutation({
    mutationFn: (text: string) =>
      apiFetch<PostResponse>(`/api/tasks/${taskId}/comments`, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      }),
    onSuccess: () => {
      setBody("");
      setPostError(null);
      queryClient.invalidateQueries({ queryKey: ["comments", taskId] });
    },
    onError: (err) =>
      setPostError(err instanceof Error ? err.message : "failed to post"),
  });

  return (
    <section className="mt-5 border-t border-border pt-4">
      <h3 className="text-xs font-medium text-muted mb-3 uppercase tracking-wide">
        comments
      </h3>

      {isLoading && (
        <p className="text-xs text-muted">loading…</p>
      )}

      {data && data.comments.length === 0 && (
        <p className="text-xs text-muted italic">no comments yet.</p>
      )}

      {data && data.comments.length > 0 && (
        <ul className="space-y-3 mb-4">
          {data.comments.map((c) => (
            <li key={c.id} className="flex gap-2">
              {/* Avatar initial */}
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent flex items-center justify-center text-xs font-semibold text-white">
                {c.author.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{c.author.name}</span>
                  <span className="text-xs text-muted">{formatDate(c.createdAt)}</span>
                </div>
                <p className="text-sm mt-0.5 whitespace-pre-wrap break-words">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canPost ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!body.trim()) return;
            postComment.mutate(body.trim());
          }}
          className="flex gap-2 items-start"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="add a comment…"
            rows={2}
            className="flex-1 rounded-md bg-bg border border-border px-3 py-2 text-sm focus:border-accent focus:outline-none resize-none"
          />
          <button
            type="submit"
            disabled={postComment.isPending || !body.trim()}
            className="text-sm px-3 py-2 rounded-md bg-accent text-white hover:bg-indigo-500 disabled:opacity-50 whitespace-nowrap"
          >
            {postComment.isPending ? "posting…" : "post"}
          </button>
        </form>
      ) : (
        <p className="text-xs text-muted italic">viewers cannot post comments.</p>
      )}

      {postError && (
        <p className="text-xs text-red-400 mt-1" role="alert">
          {postError}
        </p>
      )}
    </section>
  );
}
