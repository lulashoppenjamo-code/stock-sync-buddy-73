
CREATE TABLE public.audit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  category text NOT NULL,
  branch text NOT NULL,
  barcode text NOT NULL,
  product_name text NOT NULL,
  system_stock numeric NOT NULL,
  counted_quantity numeric NOT NULL,
  difference numeric NOT NULL,
  collaborator_id uuid,
  collaborator_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_history TO anon, authenticated;
GRANT ALL ON public.audit_history TO service_role;
ALTER TABLE public.audit_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read audit_history" ON public.audit_history FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert audit_history" ON public.audit_history FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE INDEX idx_audit_history_session ON public.audit_history(session_id);
CREATE INDEX idx_audit_history_category_created ON public.audit_history(category, created_at DESC);
