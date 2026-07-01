DROP POLICY IF EXISTS "Anyone view active templates" ON public.templates;
CREATE POLICY "Anyone view active templates"
  ON public.templates FOR SELECT
  TO anon, authenticated
  USING (active = true);
GRANT SELECT ON public.templates TO anon;