// Logical-page segmentation: slice a parent PDF into typed sub-documents
// using per-page boundary metadata from the vision extraction pass.
// No extra LLM calls — segments come from src/lib/segment-pages.ts.

import { PDFDocument } from "pdf-lib";
import { saveSplit, type DocumentSplitRow } from "./documents";
import {
  stitchSegments,
  type DocumentSegment,
  type PageMeta,
} from "./segment-pages";

const MIN_PAGES_FOR_SPLIT = 2;

/** Extract a 1-based inclusive page range as a new PDF Blob. */
export async function extractPdfPages(
  originalPdfBytes: ArrayBuffer,
  startPage: number,
  endPage: number,
): Promise<Blob> {
  const src = await PDFDocument.load(originalPdfBytes);
  const out = await PDFDocument.create();
  const total = src.getPageCount();
  const indices: number[] = [];
  for (let p = startPage; p <= Math.min(endPage, total); p++) {
    indices.push(p - 1);
  }
  if (indices.length === 0) {
    throw new Error(`No pages in range ${startPage}-${endPage}`);
  }
  const copied = await out.copyPages(src, indices);
  copied.forEach((page) => out.addPage(page));
  const bytes = await out.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}

/**
 * Compute segments from per-page vision metadata and persist each one as
 * a sliced PDF + `document_splits` row. No-op when the source has fewer
 * than 2 pages or no segments can be detected.
 */
export async function segmentAndStorePdf(
  userId: string,
  parentDocId: string,
  originalPdfBytes: ArrayBuffer,
  pages: PageMeta[],
): Promise<DocumentSplitRow[]> {
  if (!pages || pages.length < MIN_PAGES_FOR_SPLIT) return [];

  const segments = stitchSegments(pages);
  // Only split when at least 2 distinct sub-documents were detected — a
  // single-segment PDF doesn't need a physical split.
  if (segments.length < 2) return [];

  const rows: DocumentSplitRow[] = [];
  for (const seg of segments) {
    try {
      const blob = await extractPdfPages(
        originalPdfBytes,
        seg.startPage,
        seg.endPage,
      );
      const range =
        seg.startPage === seg.endPage
          ? `${seg.startPage}`
          : `${seg.startPage}-${seg.endPage}`;
      const row = await saveSplit(userId, parentDocId, seg.docType, range, blob, {
        pageStart: seg.startPage,
        pageEnd: seg.endPage,
        confidence: seg.confidence,
        signals: seg.signals,
        needsReview: seg.needsReview,
        status: seg.needsReview ? "needs_review" : "ready",
      });
      rows.push(row);
    } catch (err) {
      console.warn(
        `[splitPdf] Failed to persist segment ${seg.docType} p${seg.startPage}-${seg.endPage}:`,
        err,
      );
    }
  }
  return rows;
}

export { stitchSegments };
export type { DocumentSegment, PageMeta };
