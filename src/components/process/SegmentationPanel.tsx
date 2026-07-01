import type { DocumentSegment } from "@/lib/segment-pages";
import { AlertTriangle, FileText, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";

type Props = {
  segments: DocumentSegment[];
  totalPages?: number;
};

/**
 * Renders the detected sub-document breakdown for a processed PDF.
 * One row per segment, with page range, detected type, confidence, and any
 * boundary signals that triggered the split. needsReview segments get an
 * amber warning so reviewers know to confirm before downstream delivery.
 */
export function SegmentationPanel({ segments, totalPages }: Props) {
  if (!segments || segments.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        No sub-documents detected — treating this PDF as a single document.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">
          Detected sub-documents
        </span>
        <span>
          {segments.length} segment{segments.length === 1 ? "" : "s"}
          {totalPages ? ` · ${totalPages} pages` : ""}
        </span>
      </div>
      <ul className="space-y-2">
        {segments.map((seg, idx) => {
          const range =
            seg.startPage === seg.endPage
              ? `Page ${seg.startPage}`
              : `Pages ${seg.startPage}–${seg.endPage}`;
          const confPct = Math.round((seg.confidence ?? 0) * 100);
          return (
            <li
              key={`${seg.startPage}-${seg.endPage}-${idx}`}
              className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{seg.docType || "unknown"}</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{range}</span>
                <span className="ml-auto flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {confPct}% conf
                  </Badge>
                  {seg.needsReview ? (
                    <Badge
                      variant="outline"
                      className="border-amber-400 bg-amber-50 text-amber-700"
                    >
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      Needs review
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="border-emerald-400 bg-emerald-50 text-emerald-700"
                    >
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      Ready
                    </Badge>
                  )}
                </span>
              </div>
              {seg.signals && seg.signals.length > 0 && (
                <div className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                  {seg.signals.map((s, i) => (
                    <span
                      key={i}
                      className="rounded bg-muted px-1.5 py-0.5 font-mono"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
