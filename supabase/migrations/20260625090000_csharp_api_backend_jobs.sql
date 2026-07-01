-- C# API backend migration: public API keys, asynchronous processing jobs,
-- and reconnectable processing events. Existing project/session/document
-- tables are preserved.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'API key',
  key_prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL UNIQUE,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_status_chk CHECK (status IN ('active', 'revoked')),
  CONSTRAINT api_keys_rate_limit_chk CHECK (rate_limit_per_minute > 0)
);

GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages api keys" ON public.api_keys;
CREATE POLICY "Service role manages api keys"
  ON public.api_keys
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_api_keys_updated ON public.api_keys;
CREATE TRIGGER trg_api_keys_updated
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_api_keys_project ON public.api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS public.processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.processing_sessions(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key text,
  input_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_path text,
  status text NOT NULL DEFAULT 'queued',
  current_step text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  result_document_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL,
  result jsonb,
  locked_by text,
  locked_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT processing_jobs_status_chk CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT processing_jobs_progress_chk CHECK (progress >= 0 AND progress <= 100)
);

GRANT SELECT, INSERT, UPDATE ON public.processing_jobs TO authenticated;
GRANT ALL ON public.processing_jobs TO service_role;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own processing jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Users insert own processing jobs" ON public.processing_jobs;
DROP POLICY IF EXISTS "Users update own processing jobs" ON public.processing_jobs;

CREATE POLICY "Users view own processing jobs"
  ON public.processing_jobs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own processing jobs"
  ON public.processing_jobs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own processing jobs"
  ON public.processing_jobs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_processing_jobs_updated ON public.processing_jobs;
CREATE TRIGGER trg_processing_jobs_updated
  BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX IF NOT EXISTS uq_processing_jobs_user_idempotency
  ON public.processing_jobs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_processing_jobs_status_created
  ON public.processing_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_project
  ON public.processing_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_session
  ON public.processing_jobs(session_id);
CREATE INDEX IF NOT EXISTS idx_processing_jobs_user
  ON public.processing_jobs(user_id);

CREATE TABLE IF NOT EXISTS public.processing_events (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  step text NOT NULL,
  message text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(job_id, sequence)
);

GRANT SELECT, INSERT ON public.processing_events TO authenticated;
GRANT ALL ON public.processing_events TO service_role;
ALTER TABLE public.processing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own processing events" ON public.processing_events;
DROP POLICY IF EXISTS "Users insert own processing events" ON public.processing_events;

CREATE POLICY "Users view own processing events"
  ON public.processing_events FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.processing_jobs j
      WHERE j.id = processing_events.job_id
        AND j.user_id = auth.uid()
    )
  );
CREATE POLICY "Users insert own processing events"
  ON public.processing_events FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.processing_jobs j
      WHERE j.id = processing_events.job_id
        AND j.user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_processing_events_job_sequence
  ON public.processing_events(job_id, sequence);
CREATE INDEX IF NOT EXISTS idx_processing_events_created
  ON public.processing_events(created_at DESC);
