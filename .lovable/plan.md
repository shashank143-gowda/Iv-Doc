# Logical Page Classification & Document Segmentation

Yes — the plan is viable and fits cleanly into the existing pipeline. We already batch page images into GPT-5 vision calls in `src/routes/api/process-stream.ts` and already have a `document_splits` table plus a (currently underused) client-side splitter in `src/lib/splitPdf.ts`. We extend rather than rebuild.

## Goals

- Get boundary metadata "for free" from the existing batched vision calls (no extra LLM round-trip).
- Decide segment boundaries deterministically in code (auditable, cheap, easy to send to the exception queue).
- Persist confirmed segments as real PDF files in `document_splits`.
- Show a segmentation panel in the UI next to the existing per-page view.

## Implementation path

### 1. Extend the vision tool schema with per-page metadata
File: `src/routes/api/process-stream.ts` (`TOOL` definition + `SYSTEM_PROMPT`).

Add a sibling array to `fields` / `field_details`:

```text
pages: [{
  page,                       // absolute page number (use the offset we already pass per batch)
  document_type,              // re-classify per page, not just per batch
  segment_role,               // "start" | "continuation" | "end" | "standalone"
  printed_page_current,       // parsed from footer if visible, else null
  printed_page_total,         // ditto
  cover_like,                 // boolean — low body-text density + logo/title
  confidence                  // 0-1
}]
```

Prompt addition: instruct the model to inspect every attached page individually, report the printed page-counter when visible (RTL-aware: also accept `١٠/٥`), and mark covers/title pages.

No new API call — we just enlarge the existing `emit_extraction` response. Batches stay at `VISION_API_BATCH_SIZE = 6`; the merge logic that already concatenates `field_details` gets a parallel branch that concatenates `pages[]` using the existing `pageOffset`.

### 2. Deterministic boundary stitcher (no LLM)
New file: `src/lib/segment-pages.ts` (pure function, unit-testable).

Input: the merged `pages[]` array. Algorithm:

1. Parse footer counters with a regex that handles `5 / 10`, `5-10`, `Page 5 of 10`, `صفحة ٥ من ١٠`, and Eastern-Arabic digits. When `printed_page_total` is consistent within a run, that's a strong segment.
2. Walk pages; start a new segment when EITHER:
   - `document_type` differs from previous page with both confidences ≥ 0.7, OR
   - `printed_page_current` resets to 1 (or the printed total changes), OR
   - current page is `cover_like` AND previous segment had `segment_role="end"` (or printed counter hit total).
3. Collapse single-page "other"/low-confidence pages into the previous segment.
4. Emit `{ docType, startPage, endPage, confidence, signals[] }` plus a `needsReview` flag when:
   - Any boundary signal conflicts (e.g. footer says continuation but document_type changed), OR
   - Average page confidence in the segment < threshold (configurable, default 0.6).

Replace the current "merge consecutive same-type" logic in `splitPdf.ts` `detectDocumentBoundaries` with a thin wrapper that calls the new stitcher.

### 3. Route low-confidence boundaries to the exception queue
Reuse the existing exceptions mechanism (same one the package validator already feeds). When `needsReview` is true, attach a `segmentation_exception` entry to the document's snapshot with the conflicting signals so the reviewer can confirm/split manually before persistence.

### 4. Physical split with pdf-lib + persistence
`src/lib/splitPdf.ts` already uses `pdf-lib` to slice ranges and `saveSplit` already writes to `document_splits`. Changes:

- Drop the client-side rasterize + `/api/classify-page` path entirely — boundaries now come from step 2.
- Add a DB migration to extend `document_splits`:
  - `page_start int`, `page_end int` (alongside the existing `page_range` text — keep for backward compat; backfill from the new columns).
  - `document_type text` (rename via view or just alias to `segment_type`).
  - `confidence numeric`.
  - `status text default 'ready'` with values `ready | needs_review | rejected`.
  - GRANTs (authenticated CRUD, service_role all), policies scoped to `auth.uid()`.
- `saveSplit` writes the new columns; the PDF blob upload path is unchanged.

### 5. UI: segmentation view
New component: `src/components/process/SegmentationPanel.tsx`.

- Rendered as a new tab/section beside the existing per-page extraction view on `/process` and inside `ProjectDocumentDetail`.
- Lists each detected sub-document: page range, detected type, confidence chip, status badge, signals tooltip, "Download segment" (uses `getSignedDownloadUrl`), "Mark as exception" / "Confirm" buttons.
- When `status='needs_review'`, shows the conflicting signals inline and surfaces a manual range editor.

## Technical notes

- All segmentation logic is pure and lives in `src/lib/segment-pages.ts` so it can be unit-tested with fixture `pages[]` arrays.
- The vision call cost stays flat: same images, same batches, just a larger structured response.
- pdf-lib runs client-side today; we keep it there to avoid Worker memory pressure on large PDFs.
- Backward compat: existing `documents` without `pages[]` metadata simply skip segmentation (`document_splits` stays empty), so no migration of historical data is required.

## Out of scope (call out explicitly)

- No fine-tuning or separate classifier model.
- No automatic re-extraction per segment in this pass — segments inherit the parent's already-extracted fields, scoped by page range. A follow-up can re-run extraction per segment if needed.
