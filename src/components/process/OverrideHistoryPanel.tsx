import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, History, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type OverrideRow = {
  id: string;
  action: string;
  note: string | null;
  user_id: string;
  created_at: string;
  before_fields: Record<string, unknown> | null;
  after_fields: Record<string, unknown> | null;
};

function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { key: string; before: string; after: string }[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const changed: { key: string; before: string; after: string }[] = [];
  for (const k of keys) {
    const bv = b[k] == null ? "" : String(b[k]);
    const av = a[k] == null ? "" : String(a[k]);
    if (bv !== av) changed.push({ key: k, before: bv, after: av });
  }
  return changed;
}

function actionLabel(action: string): string {
  if (action === "approve_override") return "Approved override";
  if (action === "reject") return "Rejected";
  return action;
}

function shortUser(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export function OverrideHistoryPanel({ documentId }: { documentId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .from("document_override_history")
      .select("id, action, note, user_id, created_at, before_fields, after_fields")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false })
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setRows((data as OverrideRow[]) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  return (
    <div className="rounded-xl border hairline bg-background">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4 text-[var(--color-accent)]" />
          Override history
          {rows.length > 0 && (
            <span className="chip text-xs">{rows.length}</span>
          )}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="border-t hairline p-3 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history…
            </div>
          )}
          {error && (
            <div className="text-xs text-destructive">Error: {error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="text-xs text-muted-foreground">
              No override events recorded for this document yet.
            </div>
          )}
          {rows.map((row) => {
            const diffs = diffFields(row.before_fields, row.after_fields);
            const isReject = row.action === "reject";
            return (
              <div
                key={row.id}
                className={
                  "rounded-lg border p-3 text-sm " +
                  (isReject
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-emerald-500/30 bg-emerald-500/5")
                }
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-medium">{actionLabel(row.action)}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(row.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  by {shortUser(row.user_id)}
                </div>
                {row.note && (
                  <div className="mt-2 text-xs text-foreground/80 italic">
                    “{row.note}”
                  </div>
                )}
                {diffs.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                      Changed fields ({diffs.length})
                    </div>
                    <div className="space-y-1">
                      {diffs.map((d) => (
                        <div
                          key={d.key}
                          className="rounded-md border hairline bg-background p-2 text-xs"
                        >
                          <div className="font-medium">{d.key}</div>
                          <div className="mt-1 grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                Before
                              </div>
                              <div className="line-through text-destructive break-words">
                                {d.before || <em className="opacity-60">empty</em>}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                                After
                              </div>
                              <div className="text-emerald-700 break-words">
                                {d.after || <em className="opacity-60">empty</em>}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
