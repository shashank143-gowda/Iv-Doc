import { CircleAlert, CheckCircle2, Layers } from "lucide-react";
import { runTier3Validation, type ValidationCheck } from "@/lib/validators";

type DocLike = {
  fileName: string;
  documentType?: string;
  fields: Record<string, unknown>;
  status?: string;
  decision?: string;
};

export function Tier3Panel({
  docs,
  perDocException,
}: {
  docs: DocLike[];
  /** True when at least one per-document decision is exception_queue. */
  perDocException: boolean;
}) {
  const eligible = docs.filter((d) => d.status === "done");
  if (eligible.length < 2) return null;

  const checks: ValidationCheck[] = runTier3Validation(
    eligible.map((d) => ({
      fileName: d.fileName,
      documentType: d.documentType,
      fields: d.fields,
    })),
  );

  const failed = checks.filter((c) => c.status === "fail").length;
  const warned = checks.filter((c) => c.status === "warn").length;
  const tier3Triggered = failed + warned > 0;
  // Visually distinct when Tier-3 is the sole cause of an exception.
  const tier3Only = tier3Triggered && !perDocException;

  const headerClasses = tier3Triggered
    ? tier3Only
      ? "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-800"
      : "border-amber-500/30 bg-amber-500/5 text-amber-800"
    : "border-emerald-500/30 bg-emerald-500/5 text-emerald-800";

  return (
    <section className="bento p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-[var(--color-accent)]" />
          <h2 className="font-display text-lg">
            Package validation · Tier 3
          </h2>
        </div>
        {tier3Only && (
          <span className="chip !bg-fuchsia-500/15 !text-fuchsia-800 !border-fuchsia-500/40">
            <CircleAlert className="h-3.5 w-3.5" /> Cross-document only
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Consistency checks across {eligible.length} documents in this package.
      </div>

      <div className={"mt-3 rounded-xl border p-3 text-sm " + headerClasses}>
        {tier3Triggered ? (
          <div className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4" />
            <span>
              {failed} failed / {warned} warning
              {warned === 1 ? "" : "s"} across documents
              {tier3Only && " · package routed to exception queue solely on Tier-3"}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>All Tier-3 cross-document checks passed.</span>
          </div>
        )}
      </div>

      {checks.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {checks.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border hairline bg-background p-2.5 text-sm"
            >
              <div className="flex items-center gap-2">
                {c.status === "pass" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <CircleAlert
                    className={
                      "h-3.5 w-3.5 " +
                      (c.status === "fail"
                        ? "text-destructive"
                        : "text-amber-600")
                    }
                  />
                )}
                <span className="font-medium">{c.label ?? c.id}</span>
                <span className="ml-auto text-[11px] uppercase tracking-widest text-muted-foreground">
                  {c.status}
                </span>
              </div>
              {c.detail && (
                <div className="mt-1 text-xs text-foreground/80">
                  {c.detail}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
