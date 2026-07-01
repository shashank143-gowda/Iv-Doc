
-- 1) processing_sessions
CREATE TABLE IF NOT EXISTS public.processing_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  package_validation jsonb NOT NULL DEFAULT '[]'::jsonb,
  package_decision text,
  package_decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.processing_sessions TO authenticated;
GRANT ALL ON public.processing_sessions TO service_role;

ALTER TABLE public.processing_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own sessions" ON public.processing_sessions;
DROP POLICY IF EXISTS "Users insert own sessions" ON public.processing_sessions;
DROP POLICY IF EXISTS "Users update own sessions" ON public.processing_sessions;
DROP POLICY IF EXISTS "Users delete own sessions" ON public.processing_sessions;

CREATE POLICY "Users view own sessions" ON public.processing_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own sessions" ON public.processing_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own sessions" ON public.processing_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own sessions" ON public.processing_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_processing_sessions_updated_at ON public.processing_sessions;
DROP TRIGGER IF EXISTS trg_processing_sessions_updated ON public.processing_sessions;

CREATE TRIGGER trg_processing_sessions_updated
  BEFORE UPDATE ON public.processing_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Alter project_documents
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.processing_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extraction_source text,
  ADD COLUMN IF NOT EXISTS template_id uuid,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS corrected_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS template_fingerprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS override_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS preprocessing jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS storage_path text;

CREATE INDEX IF NOT EXISTS idx_project_documents_session_id ON public.project_documents(session_id);

-- 3) templates
CREATE TABLE IF NOT EXISTS public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  document_type text,
  version integer NOT NULL DEFAULT 1,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  anchor_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  coordinate_regions jsonb NOT NULL DEFAULT '{}'::jsonb,
  regex_patterns jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.templates TO authenticated;
GRANT ALL ON public.templates TO service_role;

ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated view active templates" ON public.templates;

CREATE POLICY "Authenticated view active templates" ON public.templates
  FOR SELECT TO authenticated USING (active = true);

DROP TRIGGER IF EXISTS update_templates_updated_at ON public.templates;

CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Now we can add the FK from project_documents.template_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_documents_template_id_fkey'
      AND conrelid = 'public.project_documents'::regclass
  ) THEN
    ALTER TABLE public.project_documents
      ADD CONSTRAINT project_documents_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4) Seed templates (idempotent)
INSERT INTO public.templates (template_key, name, document_type, version, fields, anchor_keywords, coordinate_regions, regex_patterns, active)
VALUES
(
  'swift_remittance',
  'SWIFT MT103 Remittance',
  'SWIFT Remittance',
  1,
  '{"sender":{"type":"string","required":true},"beneficiary":{"type":"string","required":true},"iban":{"type":"string","required":true},"bic":{"type":"string","required":true},"amount":{"type":"number","required":true},"currency":{"type":"string","required":true},"value_date":{"type":"date","required":true},"reference":{"type":"string","required":false}}'::jsonb,
  '["MT103","SWIFT","Ordering Customer","Beneficiary Customer","Value Date","Remittance Information","BIC","IBAN"]'::jsonb,
  '{"header":{"x":0,"y":0,"w":1,"h":0.15},"sender_block":{"x":0,"y":0.15,"w":0.5,"h":0.25},"beneficiary_block":{"x":0.5,"y":0.15,"w":0.5,"h":0.25},"amount_block":{"x":0,"y":0.4,"w":1,"h":0.15}}'::jsonb,
  '{"iban":"[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}","bic":"[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?","amount":"[0-9]+(?:[.,][0-9]{2})","currency":"[A-Z]{3}","value_date":"(20[0-9]{2})[-/]?(0[1-9]|1[0-2])[-/]?(0[1-9]|[12][0-9]|3[01])"}'::jsonb,
  true
),
(
  'kyc_passport',
  'KYC Passport',
  'KYC Passport',
  1,
  '{"full_name":{"type":"string","required":true},"document_number":{"type":"string","required":true},"nationality":{"type":"string","required":true},"date_of_birth":{"type":"date","required":true},"sex":{"type":"string","required":false},"issue_date":{"type":"date","required":false},"expiry_date":{"type":"date","required":true},"issuing_country":{"type":"string","required":true},"mrz":{"type":"string","required":false}}'::jsonb,
  '["PASSPORT","Passeport","Surname","Given Names","Nationality","Date of birth","Date of expiry","Place of birth","Authority","P<"]'::jsonb,
  '{"mrz_zone":{"x":0,"y":0.78,"w":1,"h":0.22},"photo_zone":{"x":0.02,"y":0.18,"w":0.28,"h":0.42},"data_zone":{"x":0.32,"y":0.18,"w":0.66,"h":0.6}}'::jsonb,
  '{"mrz_line":"P<[A-Z<]{3}[A-Z<]+<<[A-Z<]+","document_number":"[A-Z0-9]{6,9}","date":"([0-9]{2}[ /.-][A-Z]{3}[ /.-][0-9]{4})|([0-9]{4}[-/][0-9]{2}[-/][0-9]{2})","country_code":"[A-Z]{3}"}'::jsonb,
  true
),
(
  'salary_slip',
  'Salary Slip',
  'Salary Slip',
  1,
  '{"employee_name":{"type":"string","required":true},"employee_id":{"type":"string","required":false},"employer":{"type":"string","required":true},"pay_period":{"type":"string","required":true},"pay_date":{"type":"date","required":true},"gross_pay":{"type":"number","required":true},"deductions":{"type":"number","required":false},"net_pay":{"type":"number","required":true},"currency":{"type":"string","required":true},"iban":{"type":"string","required":false}}'::jsonb,
  '["Payslip","Pay Slip","Salary Slip","Employee","Employer","Pay Period","Gross","Net Pay","Deductions","Basic Salary"]'::jsonb,
  '{"header":{"x":0,"y":0,"w":1,"h":0.15},"employee_block":{"x":0,"y":0.15,"w":0.5,"h":0.2},"employer_block":{"x":0.5,"y":0.15,"w":0.5,"h":0.2},"earnings_table":{"x":0,"y":0.35,"w":1,"h":0.45},"totals_block":{"x":0.5,"y":0.8,"w":0.5,"h":0.2}}'::jsonb,
  '{"amount":"[0-9]+(?:[.,][0-9]{2})","currency":"[A-Z]{3}","date":"(20[0-9]{2})[-/]?(0[1-9]|1[0-2])[-/]?(0[1-9]|[12][0-9]|3[01])","iban":"[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}([A-Z0-9]?){0,16}"}'::jsonb,
  true
)
ON CONFLICT (template_key) DO UPDATE SET
  name = EXCLUDED.name,
  document_type = EXCLUDED.document_type,
  version = EXCLUDED.version,
  fields = EXCLUDED.fields,
  anchor_keywords = EXCLUDED.anchor_keywords,
  coordinate_regions = EXCLUDED.coordinate_regions,
  regex_patterns = EXCLUDED.regex_patterns,
  active = EXCLUDED.active,
  updated_at = now();

-- 5) document_override_history
CREATE TABLE IF NOT EXISTS public.document_override_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  session_id uuid REFERENCES public.processing_sessions(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  before_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.document_override_history TO authenticated;
GRANT ALL ON public.document_override_history TO service_role;

ALTER TABLE public.document_override_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own override history" ON public.document_override_history;
DROP POLICY IF EXISTS "Users insert own override history" ON public.document_override_history;

CREATE POLICY "Users view own override history" ON public.document_override_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own override history" ON public.document_override_history
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_document_override_history_document_id ON public.document_override_history(document_id);
CREATE INDEX IF NOT EXISTS idx_document_override_history_session_id ON public.document_override_history(session_id);
