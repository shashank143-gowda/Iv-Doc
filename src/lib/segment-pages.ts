// Deterministic page-boundary stitcher. Consumes per-page metadata emitted
// by the vision model (see PageMeta in src/routes/api/process-stream.ts) and
// produces document segments without any extra LLM call.
//
// Boundary signals (in priority order):
//   1) printed page-counter footer ("5/10", "Page 5 of 10", Arabic "صفحة ٥ من ١٠")
//   2) document_type discontinuity between consecutive pages (both confident)
//   3) cover-like page starting after the previous segment hit its printed total
//      or had segment_role="end"
//
// Conflicting or low-confidence signals flip needsReview so the UI / exception
// queue can ask a human to confirm.

export type PageMeta = {
  page: number;
  document_type: string;
  segment_role: "start" | "continuation" | "end" | "standalone";
  printed_page_current?: number | null;
  printed_page_total?: number | null;
  cover_like?: boolean;
  confidence: number;
};

export type DocumentSegment = {
  docType: string;
  startPage: number;
  endPage: number;
  confidence: number;
  needsReview: boolean;
  signals: string[];
};

const DOC_TYPE_CHANGE_MIN_CONF = 0.7;
const SEGMENT_LOW_CONF_THRESHOLD = 0.6;

/** Convert Eastern-Arabic digits (٠-٩ / ۰-۹) inside a string to Western digits. */
export function normalizeDigits(s: string): string {
  if (!s) return s;
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/**
 * Parse a printed page-counter footer ("5/10", "5 of 10", "5 - 10",
 * Arabic "صفحة ٥ من ١٠"). Returns null when no counter found.
 */
export function parsePrintedCounter(
  text: string,
): { current: number; total: number } | null {
  if (!text) return null;
  const normalized = normalizeDigits(text);
  const patterns: RegExp[] = [
    /\b(\d{1,4})\s*[\/\-of]+\s*(\d{1,4})\b/i,
    /\bpage\s+(\d{1,4})\s+of\s+(\d{1,4})\b/i,
    /صفحة\s*(\d{1,4})\s*من\s*(\d{1,4})/,
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    if (m) {
      const c = Number(m[1]);
      const t = Number(m[2]);
      if (c > 0 && t > 0 && c <= t && t <= 9999) {
        return { current: c, total: t };
      }
    }
  }
  return null;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

/**
 * Stitch per-page metadata into segments. Pure / deterministic — same input
 * always produces the same output. Sort pages ascending first; gaps in page
 * numbers are tolerated (segment just spans the available range).
 */
export function stitchSegments(pages: PageMeta[]): DocumentSegment[] {
  if (!pages || pages.length === 0) return [];
  const sorted = [...pages].sort((a, b) => a.page - b.page);

  type Open = {
    docType: string;
    startPage: number;
    endPage: number;
    confidences: number[];
    printedTotal: number | null;
    lastPrintedCurrent: number | null;
    lastRole: PageMeta["segment_role"];
    signals: string[];
    conflict: boolean;
  };

  const segments: DocumentSegment[] = [];
  let open: Open | null = null;

  const closeOpen = () => {
    if (!open) return;
    const confidence = avg(open.confidences);
    const lowConf = confidence < SEGMENT_LOW_CONF_THRESHOLD;
    if (lowConf) open.signals.push(`avg_confidence=${confidence.toFixed(2)}`);
    segments.push({
      docType: open.docType,
      startPage: open.startPage,
      endPage: open.endPage,
      confidence,
      needsReview: open.conflict || lowConf,
      signals: open.signals,
    });
    open = null;
  };

  for (const p of sorted) {
    const docType = (p.document_type || "unknown").toLowerCase();
    const conf = typeof p.confidence === "number" ? p.confidence : 0;
    const role = p.segment_role || "continuation";

    if (!open) {
      open = {
        docType,
        startPage: p.page,
        endPage: p.page,
        confidences: [conf],
        printedTotal: p.printed_page_total ?? null,
        lastPrintedCurrent: p.printed_page_current ?? null,
        lastRole: role,
        signals: [`start=${role}`],
        conflict: false,
      };
      continue;
    }

    const reasons: string[] = [];
    let boundary = false;

    // Signal 1: printed counter reset / total changed.
    if (
      p.printed_page_current != null &&
      open.lastPrintedCurrent != null &&
      p.printed_page_current === 1 &&
      open.lastPrintedCurrent > 1
    ) {
      boundary = true;
      reasons.push("printed_counter_reset");
    }
    if (
      p.printed_page_total != null &&
      open.printedTotal != null &&
      p.printed_page_total !== open.printedTotal
    ) {
      boundary = true;
      reasons.push("printed_total_changed");
    }

    // Signal 2: confident document_type change.
    const docTypeChanged =
      docType !== open.docType &&
      conf >= DOC_TYPE_CHANGE_MIN_CONF &&
      avg(open.confidences.slice(-1)) >= DOC_TYPE_CHANGE_MIN_CONF;
    if (docTypeChanged) {
      boundary = true;
      reasons.push(`doc_type_change(${open.docType}→${docType})`);
    }

    // Signal 3: cover/title page after a closed segment.
    const previousEnded =
      open.lastRole === "end" ||
      (open.printedTotal != null &&
        open.lastPrintedCurrent != null &&
        open.lastPrintedCurrent >= open.printedTotal);
    if (p.cover_like && previousEnded) {
      boundary = true;
      reasons.push("cover_after_end");
    }

    // Explicit model signal — page marked as "start" mid-stream.
    if (role === "start" && p.page !== open.startPage) {
      boundary = true;
      reasons.push("model_segment_role=start");
    }

    // Conflict detection: footer says continuation but doc_type changed.
    if (
      docTypeChanged &&
      p.printed_page_current != null &&
      open.lastPrintedCurrent != null &&
      p.printed_page_current === open.lastPrintedCurrent + 1 &&
      p.printed_page_total === open.printedTotal
    ) {
      open.conflict = true;
      reasons.push("conflict:doctype_change_but_footer_continues");
    }

    // Lone low-confidence "other" page → fold into previous instead of splitting.
    const isWeakOther =
      (docType === "other" || docType === "unknown") && conf < 0.5;
    if (boundary && !isWeakOther) {
      open.signals.push(...reasons);
      closeOpen();
      open = {
        docType,
        startPage: p.page,
        endPage: p.page,
        confidences: [conf],
        printedTotal: p.printed_page_total ?? null,
        lastPrintedCurrent: p.printed_page_current ?? null,
        lastRole: role,
        signals: [`start=${role}`, ...reasons],
        conflict: false,
      };
      continue;
    }

    // Continue current segment.
    open.endPage = p.page;
    open.confidences.push(conf);
    open.lastRole = role;
    if (p.printed_page_total != null && open.printedTotal == null) {
      open.printedTotal = p.printed_page_total;
    }
    if (p.printed_page_current != null) {
      open.lastPrintedCurrent = p.printed_page_current;
    }
    if (reasons.length) open.signals.push(...reasons);
  }

  closeOpen();
  return segments;
}
