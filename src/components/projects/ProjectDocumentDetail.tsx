import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleX,
} from "lucide-react";
import type { ProjectDocument } from "@/lib/projects";
import type { ValidationCheck } from "@/lib/validators";
import { PageBreakdown } from "@/components/PageBreakdown";
import { SegmentationPanel } from "@/components/process/SegmentationPanel";

interface Props {
  doc: ProjectDocument;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border hairline p-3 bg-background">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-medium mt-1 break-words">{value}</div>
    </div>
  );
}

function CheckRow({ check }: { check: ValidationCheck }) {
  const icon =
    check.status === "pass" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : check.status === "fail" ? (
      <CircleX className="h-4 w-4 text-destructive" />
    ) : check.status === "warn" ? (
      <CircleAlert className="h-4 w-4 text-amber-600" />
    ) : (
      <CircleDashed className="h-4 w-4 text-muted-foreground" />
    );
  return (
    <div className="flex items-start gap-3 py-1 text-sm">
      <span className="mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{check.label}</div>
        {check.detail && (
          <div className="text-xs text-muted-foreground mt-0.5 break-words">
            {check.detail}
          </div>
        )}
      </div>
    </div>
  );
}

function DecisionPanel({ doc }: { doc: ProjectDocument }) {
  const approved = doc.decision === "auto_approve";
  return (
    <div
      className={
        "rounded-xl border p-4 " +
        (approved
          ? "border-emerald-500/30 bg-emerald-500/5"
          : doc.decision === "rejected"
            ? "border-destructive/30 bg-destructive/5"
            : "border-amber-500/30 bg-amber-500/5")
      }
    >
      <div className="flex items-center gap-2">
        {approved ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : doc.decision === "rejected" ? (
          <CircleX className="h-4 w-4 text-destructive" />
        ) : (
          <CircleAlert className="h-4 w-4 text-amber-600" />
        )}
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Decision
        </div>
        <div className="text-sm font-medium">
          {approved
            ? "Auto-approved"
            : doc.decision === "rejected"
              ? "Rejected"
              : doc.decision === "exception_queue"
                ? "Exception queue"
                : "Pending"}
        </div>
      </div>
      {doc.decisionReason && (
        <div className="mt-1.5 text-sm text-foreground/80">
          {doc.decisionReason}
        </div>
      )}
    </div>
  );
}

export function ProjectDocumentDetail({ doc }: Props) {
  const fieldEntries = Object.entries(doc.fields ?? {});
  const fieldCount = fieldEntries.length;
  const confValues = Object.values(doc.fieldConfidence ?? {});
  const avgConf =
    confValues.length > 0
      ? confValues.reduce((sum, v) => sum + v, 0) / confValues.length
      : null;
  const checks = doc.validation ?? [];
  const pass = checks.filter((c) => c.status === "pass").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const skipped = checks.filter((c) => c.status === "skipped").length;

  const metrics: { label: string; value: string }[] = [
    {
      label: "File size",
      value: doc.fileSize ? `${Math.round(doc.fileSize / 1024)} KB` : "—",
    },
    { label: "Type", value: doc.mimeType || "—" },
    {
      label: "OCR chars",
      value: doc.rawText ? String(doc.rawText.length) : "—",
    },
    { label: "Fields", value: String(fieldCount) },
    {
      label: "Avg confidence",
      value: avgConf != null ? `${(avgConf * 100).toFixed(0)}%` : "—",
    },
    {
      label: "Checks",
      value:
        checks.length === 0
          ? "Not run"
          : `${pass} pass / ${fail} fail / ${warn} warn${skipped ? ` / ${skipped} skipped` : ""}`,
    },
  ];

  return (
    <div className="space-y-4">
      {doc.error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {doc.error}
        </div>
      )}

      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
          Run summary
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {metrics.map((m) => (
            <Metric key={m.label} label={m.label} value={m.value} />
          ))}
        </div>
      </div>

      {doc.decision && <DecisionPanel doc={doc} />}

      {doc.documentType && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Classified
            </div>
            <div className="font-display text-lg">{doc.documentType}</div>
          </div>
          {doc.classificationConfidence !== undefined && (
            <div className="text-xs text-muted-foreground">
              Confidence{" "}
              {(doc.classificationConfidence * 100).toFixed(0)}%
              {doc.language ? ` · ${doc.language}` : ""}
            </div>
          )}
        </div>
      )}

      {fieldEntries.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Extracted fields — {fieldCount}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {fieldEntries.map(([key, value]) => {
              const confidence = doc.fieldConfidence?.[key];
              return (
                <div
                  key={key}
                  className="rounded-xl border hairline p-3 bg-background"
                >
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground flex items-center justify-between gap-3">
                    <span className="truncate">{key}</span>
                    {typeof confidence === "number" && (
                      <span
                        className={
                          confidence >= 0.8
                            ? "text-emerald-600"
                            : confidence >= 0.6
                              ? "text-amber-600"
                              : "text-destructive"
                        }
                      >
                        {(confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-medium break-words min-h-[1.25rem]">
                    {value === null || value === undefined || value === "" ? (
                      <span className="text-muted-foreground italic">
                        empty
                      </span>
                    ) : (
                      String(value)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {checks.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
            Validation shield
          </div>
          <div className="space-y-1">
            {[1, 2, 3].map((tier) => {
              const items = checks.filter((c) => c.tier === tier);
              if (items.length === 0) return null;
              return (
                <div key={tier} className="pt-2 first:pt-0">
                  <div className="text-[10px] uppercase tracking-widest text-[var(--color-accent)] mb-1">
                    Tier 0{tier}
                  </div>
                  {items.map((c) => (
                    <CheckRow key={c.id} check={c} />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <PageBreakdown doc={{ rawText: doc.rawText, pageInfo: doc.pageInfo }} />

      {doc.segments && doc.segments.length > 0 && (
        <div>
          <SegmentationPanel
            segments={doc.segments}
            totalPages={doc.pages?.length}
          />
        </div>
      )}

      {doc.rawText && (
        <details className="rounded-xl border hairline p-3 bg-background">
          <summary className="cursor-pointer text-xs uppercase tracking-widest text-muted-foreground">
            Raw OCR text
          </summary>
          <pre className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80 max-h-64 overflow-auto">
            {doc.rawText}
          </pre>
        </details>
      )}
    </div>
  );
}
