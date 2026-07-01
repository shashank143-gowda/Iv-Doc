ALTER TABLE public.processing_sessions
ADD COLUMN IF NOT EXISTS package_validation_results jsonb NOT NULL DEFAULT '[]'::jsonb;