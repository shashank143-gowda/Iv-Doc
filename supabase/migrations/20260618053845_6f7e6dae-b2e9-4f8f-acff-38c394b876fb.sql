
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  storage_path text,
  doc_type text,
  status text DEFAULT 'received',
  page_count integer,
  uploaded_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own documents"
  ON public.documents FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.document_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_type text,
  page_range text,
  storage_path text,
  extracted_fields jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_splits TO authenticated;
GRANT ALL ON public.document_splits TO service_role;

ALTER TABLE public.document_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own splits"
  ON public.document_splits FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_documents_user_id ON public.documents(user_id);
CREATE INDEX idx_splits_parent ON public.document_splits(parent_document_id);
CREATE INDEX idx_splits_user_id ON public.document_splits(user_id);

-- Storage policies for the 'documents' bucket: users may only touch their own folder.
CREATE POLICY "User upload own folder"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "User read own folder"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "User delete own folder"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);
