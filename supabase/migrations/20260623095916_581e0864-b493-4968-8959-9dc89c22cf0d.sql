
ALTER TABLE public.document_splits
  ADD COLUMN IF NOT EXISTS page_start INTEGER,
  ADD COLUMN IF NOT EXISTS page_end INTEGER,
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false;

-- Backfill page_start / page_end from existing page_range strings like "3" or "3-5"
UPDATE public.document_splits
SET
  page_start = COALESCE(page_start, NULLIF(split_part(page_range, '-', 1), '')::int),
  page_end   = COALESCE(page_end,   NULLIF(split_part(page_range, '-', 2), '')::int)
WHERE page_range ~ '^[0-9]+(-[0-9]+)?$';

UPDATE public.document_splits SET page_end = page_start WHERE page_end IS NULL AND page_start IS NOT NULL;

-- document_type alias from segment_type if missing
UPDATE public.document_splits SET document_type = segment_type WHERE document_type IS NULL;

ALTER TABLE public.document_splits
  ADD CONSTRAINT document_splits_status_chk
  CHECK (status IN ('ready','needs_review','rejected','confirmed'));

CREATE INDEX IF NOT EXISTS document_splits_parent_idx
  ON public.document_splits(parent_document_id);
