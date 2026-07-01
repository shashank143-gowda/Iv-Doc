
CREATE TABLE public.corpus_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  doc_type text,
  original_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrected_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  image_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corpus_entries TO authenticated;
GRANT ALL ON public.corpus_entries TO service_role;

ALTER TABLE public.corpus_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own corpus" ON public.corpus_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own corpus" ON public.corpus_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own corpus" ON public.corpus_entries
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own corpus" ON public.corpus_entries
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_corpus_entries_user ON public.corpus_entries(user_id);
CREATE INDEX idx_corpus_entries_doc_type ON public.corpus_entries(doc_type);
CREATE INDEX idx_corpus_entries_created_at ON public.corpus_entries(created_at DESC);

-- Storage: projects bucket per-user folder access. Path layout:
-- {project_id}/corpus/{document_id}/{timestamp}.{ext}
-- Owner check via project lookup.
CREATE POLICY "Owners read project files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners insert project files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners update project files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners delete project files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'projects'
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id::text = split_part(name, '/', 1)
        AND p.user_id = auth.uid()
    )
  );
