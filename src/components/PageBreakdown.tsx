import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { RotateCw } from "lucide-react";
import type { PageInfo } from "@/lib/file-extract";

type Props = {
  doc: {
    rawText?: string;
    pageInfo?: PageInfo[];
  };
};

const PAGE_MARKER_RE = /---\s*Page\s+(\d+)(?:[–-]\d+)?(?:\s*\(supplement\))?\s*---/gi;

function splitPages(rawText?: string): Map<number, string> {
  const map = new Map<number, string>();
  if (!rawText) return map;
  const matches = [...rawText.matchAll(PAGE_MARKER_RE)];
  if (matches.length === 0) {
    map.set(1, rawText.trim());
    return map;
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const page = Number(m[1]);
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? rawText.length : rawText.length;
    const chunk = rawText.slice(start, end).trim();
    const existing = map.get(page);
    map.set(page, existing ? `${existing}\n${chunk}` : chunk);
  }
  return map;
}

function summarize(text: string, max = 220): string {
  const clean = text
    .replace(/\[(?:stamp|signature|illegible)\]/gi, "")
    .replace(/█+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "No text detected on this page.";
  if (clean.length <= max) return clean;
  return clean.slice(0, max).trimEnd() + "…";
}

export function PageBreakdown({ doc }: Props) {
  const pageTexts = splitPages(doc.rawText);
  const pageInfo = doc.pageInfo ?? [];
  const allPages = new Set<number>([
    ...pageTexts.keys(),
    ...pageInfo.map((p) => p.page),
  ]);
  const pages = [...allPages].sort((a, b) => a - b);

  if (pages.length === 0) return null;

  const rotatedCount = pageInfo.filter(
    (p) => Math.abs(p.rotationApplied ?? 0) >= 0.5,
  ).length;

  return (
    <div className="mt-3">
      <Accordion type="single" collapsible>
        <AccordionItem value="pages" className="border rounded-xl hairline bg-background">
          <AccordionTrigger className="px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:no-underline">
            <span className="flex items-center gap-2">
              Per-page analysis
              <span className="text-[10px] normal-case tracking-normal text-muted-foreground/80">
                ({pages.length} page{pages.length === 1 ? "" : "s"}
                {rotatedCount > 0
                  ? ` · ${rotatedCount} auto-rotated`
                  : ""}
                )
              </span>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-3 pb-3">
            <ul className="space-y-2">
              {pages.map((page) => {
                const info = pageInfo.find((p) => p.page === page);
                const text = pageTexts.get(page) ?? "";
                const rot = info?.rotationApplied ?? 0;
                const skew = info?.skewAngleDetected ?? 0;
                const wasRotated = Math.abs(rot) >= 0.5;
                return (
                  <li
                    key={page}
                    className="rounded-lg border hairline p-2.5 bg-muted/30"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-xs font-semibold">Page {page}</div>
                      <div className="flex items-center gap-2 text-[11px]">
                        {info ? (
                          wasRotated ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 px-2 py-0.5">
                              <RotateCw className="h-3 w-3" />
                              Rotated {rot > 0 ? "+" : ""}
                              {rot.toFixed(1)}° (auto-corrected)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 px-2 py-0.5">
                              Upright
                            </span>
                          )
                        ) : null}
                        {info && Math.abs(skew) >= 0.1 && !wasRotated ? (
                          <span className="text-muted-foreground">
                            skew {skew.toFixed(2)}°
                          </span>
                        ) : null}
                        {info?.width && info?.height ? (
                          <span className="text-muted-foreground">
                            {info.width}×{info.height}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {summarize(text)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
