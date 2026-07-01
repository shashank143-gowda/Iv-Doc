import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Logo } from "@/components/Logo";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import {
  getCorpusImageUrl,
  loadCorpusEntries,
  type CorpusEntry,
} from "@/lib/workspace-db";

export const Route = createFileRoute("/corpus")({
  head: () => ({
    meta: [
      { title: "IV Doc - Training corpus" },
      {
        name: "description",
        content: "Operator override history captured as a training corpus.",
      },
    ],
  }),
  component: CorpusPage,
});

function CorpusPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<CorpusEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState<string>("");
  const [field, setField] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    if (!auth.loading && !auth.user) void navigate({ to: "/auth" });
  }, [auth.loading, auth.user, navigate]);

  useEffect(() => {
    if (!auth.user) return;
    setLoading(true);
    loadCorpusEntries(auth.user.id)
      .then((rows) => setEntries(rows))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [auth.user]);

  const docTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.docType) set.add(e.docType);
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (docType && e.docType !== docType) return false;
      if (from && new Date(e.createdAt) < new Date(from)) return false;
      if (to && new Date(e.createdAt) > new Date(`${to}T23:59:59`))
        return false;
      if (field) {
        const f = field.toLowerCase();
        const hit = Object.keys({
          ...e.originalFields,
          ...e.correctedFields,
        }).some((k) => k.toLowerCase().includes(f));
        if (!hit) return false;
      }
      return true;
    });
  }, [entries, docType, field, from, to]);

  const exportCsv = () => {
    const header = [
      "id",
      "document_id",
      "doc_type",
      "created_at",
      "field",
      "before",
      "after",
      "image_path",
    ];
    const rows: string[] = [header.join(",")];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const e of filtered) {
      const keys = new Set([
        ...Object.keys(e.originalFields),
        ...Object.keys(e.correctedFields),
      ]);
      for (const key of keys) {
        const before = e.originalFields[key];
        const after = e.correctedFields[key];
        if (before === after) continue;
        rows.push(
          [
            e.id,
            e.documentId,
            e.docType ?? "",
            e.createdAt,
            key,
            esc(before ?? ""),
            esc(after ?? ""),
            e.imagePath ?? "",
          ]
            .map((c) => esc(c))
            .join(","),
        );
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ivdoc-corpus-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 backdrop-blur-md bg-background/75 border-b hairline">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo className="h-7 w-7" />
            <span className="font-display font-semibold tracking-tight text-lg">
              IV Doc
            </span>
          </Link>
          <Link
            to="/process"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to workspace
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              Training corpus
            </h1>
            <p className="mt-2 text-muted-foreground text-sm">
              Operator overrides captured for fine-tuning. Read-only.
            </p>
          </div>
          <button
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-ink)] text-[var(--color-mist)] px-3 py-2 text-sm hover:opacity-90 disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>

        <section className="bento p-4 grid gap-3 md:grid-cols-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Document type
            </label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full rounded-lg border hairline bg-background px-2 py-1.5 text-sm"
            >
              <option value="">All</option>
              {docTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Field name contains
            </label>
            <input
              value={field}
              onChange={(e) => setField(e.target.value)}
              placeholder="e.g. iban"
              className="w-full rounded-lg border hairline bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              From
            </label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border hairline bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              To
            </label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border hairline bg-background px-2 py-1.5 text-sm"
            />
          </div>
        </section>

        {loading ? (
          <div className="bento p-8 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading corpus...
          </div>
        ) : error ? (
          <div className="bento p-6 text-sm text-destructive">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="bento p-8 text-sm text-muted-foreground">
            No corpus entries match the current filters. Operator overrides
            from the exception queue will appear here.
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => (
              <CorpusRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function CorpusRow({ entry }: { entry: CorpusEntry }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!entry.imagePath) return;
    let cancelled = false;
    void getCorpusImageUrl(entry.imagePath).then((url) => {
      if (!cancelled) setThumbUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.imagePath]);

  const keys = useMemo(() => {
    const set = new Set<string>([
      ...Object.keys(entry.originalFields),
      ...Object.keys(entry.correctedFields),
    ]);
    return [...set].filter(
      (k) => entry.originalFields[k] !== entry.correctedFields[k],
    );
  }, [entry]);

  const isImage = thumbUrl && /\.(png|jpe?g|webp|gif|tiff)$/i.test(
    entry.imagePath ?? "",
  );

  return (
    <article className="bento p-4 grid gap-4 md:grid-cols-[8rem_1fr_auto]">
      <div className="h-32 w-32 rounded-lg border hairline bg-[var(--color-mist)] overflow-hidden flex items-center justify-center text-[10px] text-muted-foreground">
        {isImage ? (
          <img
            src={thumbUrl!}
            alt="page"
            className="h-full w-full object-cover"
          />
        ) : thumbUrl ? (
          <a
            href={thumbUrl}
            target="_blank"
            rel="noreferrer"
            className="px-2 text-center hover:underline"
          >
            Open original
          </a>
        ) : (
          "no image"
        )}
      </div>
      <div className="min-w-0">
        <header className="flex flex-wrap items-baseline gap-2 mb-2">
          <span className="text-sm font-medium">
            {entry.docType ?? "unknown"}
          </span>
          <span className="text-xs text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">
            · {keys.length} field{keys.length === 1 ? "" : "s"} corrected
          </span>
        </header>
        <ul className="space-y-1">
          {keys.map((k) => (
            <li key={k} className="text-xs font-mono break-words">
              <span className="text-muted-foreground">{k}:</span>{" "}
              <span className="text-destructive line-through">
                {String(entry.originalFields[k] ?? "—")}
              </span>{" "}
              →{" "}
              <span className="text-[var(--color-accent)]">
                {String(entry.correctedFields[k] ?? "—")}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="text-[11px] text-muted-foreground self-start whitespace-nowrap">
        doc {entry.documentId.slice(0, 8)}
      </div>
    </article>
  );
}
