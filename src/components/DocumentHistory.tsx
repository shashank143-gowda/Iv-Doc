import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Scissors,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  getSignedDownloadUrl,
  getUserDocuments,
  type DocumentWithSplits,
  type DocumentSplitRow,
} from "@/lib/documents";

const TYPE_COLORS: Record<string, string> = {
  document_checklist: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  loan_contract: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  payment_schedule: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  account_opening: "bg-violet-500/10 text-violet-700 border-violet-500/30",
  remittance_form: "bg-cyan-500/10 text-cyan-700 border-cyan-500/30",
  cash_slip: "bg-rose-500/10 text-rose-700 border-rose-500/30",
  signature_page: "bg-zinc-500/10 text-zinc-700 border-zinc-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

const STATUS_COLORS: Record<string, string> = {
  received: "bg-muted text-muted-foreground border-border",
  processing: "bg-blue-500/10 text-blue-700 border-blue-500/30",
  splitting: "bg-amber-500/10 text-amber-700 border-amber-500/30",
  split_done: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  done: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
};

function Badge({
  label,
  palette,
}: {
  label: string;
  palette: Record<string, string>;
}) {
  const cls = palette[label] ?? palette.other ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {label.replace(/_/g, " ")}
    </span>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function openSigned(path: string | null) {
  if (!path) return;
  try {
    const url = await getSignedDownloadUrl(path);
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("[documents] sign url failed", err);
  }
}

function ExtractedPreview({
  fields,
}: {
  fields: DocumentSplitRow["extracted_fields"];
}) {
  const entries = useMemo(() => {
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
    return Object.entries(fields as Record<string, unknown>).slice(0, 4);
  }, [fields]);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="text-xs">
          <span className="text-muted-foreground">{k.replace(/_/g, " ")}: </span>
          <span className="text-foreground break-words">
            {v == null ? "—" : String(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

function SplitRow({ split }: { split: DocumentSplitRow }) {
  return (
    <div className="rounded-md border hairline bg-background p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Badge label={split.segment_type ?? "other"} palette={TYPE_COLORS} />
          <span className="text-xs text-muted-foreground">
            Pages {split.page_range ?? "?"}
          </span>
        </div>
        <button
          onClick={() => openSigned(split.storage_path)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" /> Download
        </button>
      </div>
      <ExtractedPreview fields={split.extracted_fields} />
    </div>
  );
}

function DocumentCard({ doc }: { doc: DocumentWithSplits }) {
  const [open, setOpen] = useState(false);
  const splits = doc.document_splits ?? [];
  return (
    <article className="rounded-xl border hairline bg-background p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[var(--color-accent)] shrink-0" />
            <h3 className="font-medium truncate">{doc.original_filename}</h3>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {doc.doc_type && (
              <Badge label={doc.doc_type} palette={TYPE_COLORS} />
            )}
            <Badge
              label={doc.status ?? "received"}
              palette={STATUS_COLORS}
            />
            <span className="text-xs text-muted-foreground">
              {formatDate(doc.uploaded_at)}
            </span>
            {typeof doc.page_count === "number" && (
              <span className="text-xs text-muted-foreground">
                · {doc.page_count} page{doc.page_count === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => openSigned(doc.storage_path)}
          className="inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" /> Download original
        </button>
      </div>

      {splits.length > 0 && (
        <div className="mt-3 rounded-lg border hairline">
          <button
            onClick={() => setOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium">
              <Scissors className="h-4 w-4 text-[var(--color-accent)]" />
              Split segments
              <span className="chip text-xs">{splits.length}</span>
            </span>
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {open && (
            <div className="border-t hairline p-3 space-y-2">
              {splits.map((s) => (
                <SplitRow key={s.id} split={s} />
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border hairline bg-background p-4 animate-pulse">
      <div className="h-4 w-1/2 bg-muted rounded mb-3" />
      <div className="h-3 w-1/3 bg-muted rounded" />
    </div>
  );
}

export function DocumentHistory() {
  const auth = useAuth();
  const [docs, setDocs] = useState<DocumentWithSplits[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) {
      setDocs([]);
      return;
    }
    let cancelled = false;
    setError(null);
    getUserDocuments(auth.user.id)
      .then((rows) => {
        if (!cancelled) setDocs(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [auth.loading, auth.user]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/75 border-b hairline">
        <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-[var(--color-ink)] grid place-items-center">
              <div className="glow-dot" />
            </div>
            <span className="font-display font-semibold tracking-tight text-lg">
              IV Doc
            </span>
          </Link>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link to="/process" className="hover:text-foreground">
              Process
            </Link>
            <Link to="/corpus" className="hover:text-foreground">
              Corpus
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="font-display text-3xl font-semibold tracking-tight mb-2">
          My Documents
        </h1>
        <p className="text-muted-foreground mb-8">
          Originals you've uploaded and any auto-detected split segments.
        </p>

        {!auth.loading && !auth.user && (
          <div className="rounded-xl border hairline bg-background p-6 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              Sign in to view your document history.
            </p>
            <Link
              to="/auth"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-ink)] px-3 py-1.5 text-sm text-[var(--color-mist)] hover:opacity-90"
            >
              Sign in
            </Link>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Error loading documents: {error}
          </div>
        )}

        {auth.user && docs === null && !error && (
          <div className="space-y-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {auth.user && docs && docs.length === 0 && (
          <div className="rounded-xl border hairline bg-background p-10 text-center">
            <Loader2 className="h-6 w-6 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground">
              No documents yet. Upload your first document to get started.
            </p>
            <Link
              to="/process"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-ink)] px-3 py-1.5 text-sm text-[var(--color-mist)] hover:opacity-90"
            >
              Go to processing
            </Link>
          </div>
        )}

        {auth.user && docs && docs.length > 0 && (
          <div className="space-y-3">
            {docs.map((d) => (
              <DocumentCard key={d.id} doc={d} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
