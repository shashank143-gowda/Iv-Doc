"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { ProjectDocument } from "@/lib/projects";

interface Props {
  docs: ProjectDocument[];
}

function valueOf(doc: ProjectDocument, key: string): string {
  const v = doc.fields?.[key];
  if (v === null || v === undefined) return "";
  return String(v);
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function ProjectCompareMatrix({ docs }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    docs.slice(0, Math.min(docs.length, 3)).map((d) => d.id),
  );

  const selected = useMemo(
    () => docs.filter((d) => selectedIds.includes(d.id)),
    [docs, selectedIds],
  );

  const fieldKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const d of selected) {
      Object.keys(d.fields ?? {}).forEach((k) => keys.add(k));
    }
    return Array.from(keys).sort();
  }, [selected]);

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const exportCsv = () => {
    const header = ["field", ...selected.map((d) => d.fileName)];
    const rows = fieldKeys.map((key) => [
      key,
      ...selected.map((d) => valueOf(d, key)),
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comparison-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (docs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No documents in this project yet. Add files to start comparing.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border hairline p-3">
        <p className="text-xs font-medium text-muted-foreground mb-2">
          Select documents to compare ({selected.length} selected)
        </p>
        <div className="flex flex-wrap gap-2">
          {docs.map((d) => {
            const active = selectedIds.includes(d.id);
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => toggle(d.id)}
                className={`text-xs px-2.5 py-1 rounded-md border hairline transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-[var(--color-mist)]"
                }`}
              >
                {d.fileName}
              </button>
            );
          })}
        </div>
      </div>

      {selected.length < 2 ? (
        <p className="text-sm text-muted-foreground">
          Select at least 2 documents to view the comparison.
        </p>
      ) : fieldKeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The selected documents have no extracted fields to compare.
        </p>
      ) : (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-md border hairline px-2.5 py-1.5 text-xs hover:bg-[var(--color-mist)]"
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border hairline">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-mist)]">
                <tr>
                  <th className="text-left p-2 font-medium text-xs sticky left-0 bg-[var(--color-mist)] z-10 min-w-[180px]">
                    Field
                  </th>
                  {selected.map((d) => (
                    <th
                      key={d.id}
                      className="text-left p-2 font-medium text-xs min-w-[180px]"
                    >
                      <div className="truncate max-w-[240px]" title={d.fileName}>
                        {d.fileName}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-normal">
                        {d.documentType ?? "—"}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fieldKeys.map((key) => {
                  const values = selected.map((d) => valueOf(d, key));
                  const present = values.filter((v) => v !== "");
                  const normalizedSet = new Set(present.map(normalize));
                  const mismatched = normalizedSet.size > 1;
                  return (
                    <tr key={key} className="border-t hairline">
                      <td className="p-2 font-mono text-xs sticky left-0 bg-background z-10 align-top">
                        {key}
                      </td>
                      {selected.map((d, i) => {
                        const v = values[i];
                        const conf = d.fieldConfidence?.[key];
                        return (
                          <td
                            key={d.id}
                            className={`p-2 align-top text-xs ${
                              mismatched && v !== ""
                                ? "bg-amber-50 text-amber-900"
                                : ""
                            }`}
                          >
                            <div className="break-words">
                              {v || (
                                <span className="text-muted-foreground italic">
                                  —
                                </span>
                              )}
                            </div>
                            {typeof conf === "number" && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                {Math.round(conf * 100)}%
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
