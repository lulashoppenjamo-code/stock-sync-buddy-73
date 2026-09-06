ALTER TABLE public.audit_comments ADD COLUMN IF NOT EXISTS session_id uuid;
CREATE INDEX IF NOT EXISTS audit_comments_session_id_idx ON public.audit_comments (session_id);
CREATE POLICY "Anyone can update audit_comments" ON public.audit_comments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);