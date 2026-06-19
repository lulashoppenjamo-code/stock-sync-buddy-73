
CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO anon, authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read categories" ON public.categories FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert categories" ON public.categories FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can delete categories" ON public.categories FOR DELETE TO anon, authenticated USING (true);

ALTER TABLE public.transfers
  ADD COLUMN received_at timestamptz,
  ADD COLUMN received_by_id uuid,
  ADD COLUMN received_by_name text,
  ADD COLUMN received_photo_url text,
  ADD COLUMN received_scanned_barcode text;

CREATE INDEX IF NOT EXISTS transfers_pending_idx ON public.transfers (received_at) WHERE received_at IS NULL;
