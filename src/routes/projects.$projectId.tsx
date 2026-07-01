import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/lib/auth";
import {
  getUserProject,
  listProjectDocuments,
  summarizeRollup,
  type ProjectDocument,
} from "@/lib/projects";
import type { Database } from "@/integrations/supabase/types";
import { ProjectDocumentsTable } from "@/components/projects/ProjectDocumentsTable";
import { ProjectCompareMatrix } from "@/components/projects/ProjectCompareMatrix";


type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

export const Route = createFileRoute("/projects/$projectId")({
  head: () => ({
    meta: [{ title: "Project — IV Doc" }],
  }),
  component: ProjectDetailPage,
});

type Tab = "documents" | "compare";

function ProjectDetailPage() {
  const { projectId } = Route.useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [tab, setTab] = useState<Tab>("documents");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const [p, d] = await Promise.all([
        getUserProject(auth.user.id, projectId),
        listProjectDocuments(projectId),
      ]);
      if (!p) {
        setError("Project not found.");
        setProject(null);
        setDocs([]);
        return;
      }
      setProject(p);
      setDocs(d);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [auth.user, projectId]);

  useEffect(() => {
    if (!auth.loading) refresh();
  }, [auth.loading, refresh]);

  if (!auth.loading && !auth.user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-xl font-semibold">Sign in to view this project</h1>
          <Link
            to="/auth"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const counts = docs.reduce(
    (acc, d) => {
      if (d.decision === "auto_approve") acc.auto_approve += 1;
      else if (d.decision === "exception_queue") acc.exception_queue += 1;
      else if (d.decision === "rejected") acc.rejected += 1;
      else acc.pending += 1;
      return acc;
    },
    { auto_approve: 0, exception_queue: 0, rejected: 0, pending: 0 },
  );

  const rollup = summarizeRollup(
    counts.rejected > 0
      ? "has_exceptions"
      : counts.exception_queue > 0 || counts.pending > 0
        ? "needs_review"
        : counts.auto_approve > 0
          ? "ready"
          : "needs_review",
  );
  const toneClass =
    rollup.tone === "ready"
      ? "bg-emerald-50 text-emerald-700"
      : rollup.tone === "danger"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";

  const addFiles = () => {
    navigate({ to: "/process", search: { projectId } as never });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <Link
          to="/projects"
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Back to projects
        </Link>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {loading && !project ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : project ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-semibold truncate">{project.name}</h1>
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${toneClass}`}
                  >
                    {rollup.label}
                  </span>
                </div>
                {project.description && (
                  <p className="text-sm text-muted-foreground mt-1">
                    {project.description}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{docs.length} document{docs.length === 1 ? "" : "s"}</span>
                  <span>· {counts.auto_approve} approved</span>
                  <span>· {counts.exception_queue} review</span>
                  {counts.rejected > 0 && <span>· {counts.rejected} rejected</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={refresh}
                  className="inline-flex items-center gap-1.5 rounded-md border hairline px-2.5 py-1.5 text-xs hover:bg-[var(--color-mist)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh
                </button>
                <button
                  type="button"
                  onClick={addFiles}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Add files
                </button>
              </div>
            </div>

            <div className="flex gap-1 border-b hairline">
              {(["documents", "compare"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                    tab === t
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "documents" ? "Documents" : "Compare"}
                </button>
              ))}
            </div>

            {tab === "documents" ? (
              <ProjectDocumentsTable docs={docs} />
            ) : (
              <ProjectCompareMatrix docs={docs} />
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
