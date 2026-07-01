import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { FolderKanban, Plus, ArrowRight, Trash2 } from "lucide-react";

import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/lib/auth";
import {
  createUserProject,
  deleteUserProject,
  listUserProjects,
  summarizeRollup,
  type ProjectSummary,
} from "@/lib/projects";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — IV Doc" },
      {
        name: "description",
        content:
          "Group related documents into projects and compare extracted fields across files.",
      },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    if (!auth.user) return;
    setLoading(true);
    try {
      const rows = await listUserProjects(auth.user.id);
      setProjects(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    if (!auth.loading) refresh();
  }, [auth.loading, refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.user || !name.trim()) return;
    setCreating(true);
    try {
      const project = await createUserProject(
        auth.user.id,
        name.trim(),
        description.trim() || undefined,
      );
      setName("");
      setDescription("");
      await refresh();
      navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteUserProject(pendingDelete.id);
      setPendingDelete(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  if (!auth.loading && !auth.user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-xl font-semibold">Sign in to view projects</h1>
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />

      <main className="mx-auto max-w-7xl px-6 py-12 space-y-8">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FolderKanban className="h-5 w-5" /> Projects
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Group related documents to track decisions together and compare
            extracted fields across files.
          </p>
        </div>

        <section className="rounded-lg border hairline p-4">
          <h2 className="text-sm font-medium mb-3">New project</h2>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr_auto] gap-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
                required
                className="rounded-md border hairline px-3 py-2 text-sm bg-background"
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                className="rounded-md border hairline px-3 py-2 text-sm bg-background"
              />
              <button
                type="submit"
                disabled={creating || !name.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Create
              </button>
            </div>
          </form>
        </section>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-medium">Your projects</h2>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : projects.length === 0 ? (
            <div className="rounded-lg border hairline p-8 text-center">
              <p className="text-sm text-muted-foreground">
                No projects yet. Create one above to get started.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {projects.map((p) => {
                const rollup = summarizeRollup(p.rollup);
                const toneClass =
                  rollup.tone === "ready"
                    ? "bg-emerald-50 text-emerald-700"
                    : rollup.tone === "danger"
                      ? "bg-red-50 text-red-700"
                      : "bg-amber-50 text-amber-700";
                return (
                  <li
                    key={p.id}
                    className="rounded-lg border hairline p-4 hover:bg-[var(--color-mist)]/40 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: p.id }}
                          className="font-medium text-sm hover:underline truncate block"
                        >
                          {p.name}
                        </Link>
                        {p.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {p.description}
                          </p>
                        )}
                      </div>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium shrink-0 ${toneClass}`}
                      >
                        {rollup.label}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {p.docCount} document{p.docCount === 1 ? "" : "s"}
                        {p.lastActivityAt && (
                          <> · updated {new Date(p.lastActivityAt).toLocaleDateString()}</>
                        )}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPendingDelete(p)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-600 p-1"
                          aria-label="Delete project"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: p.id }}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Open <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  <span className="font-medium text-foreground">
                    {pendingDelete.name}
                  </span>{" "}
                  and all {pendingDelete.docCount} document
                  {pendingDelete.docCount === 1 ? "" : "s"} attached to it will
                  be permanently removed. This action cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-600"
            >
              {deleting ? "Deleting…" : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
