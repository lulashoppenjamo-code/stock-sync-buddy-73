ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS received_quantity numeric,
  ADD COLUMN IF NOT EXISTS received_sender_name text,
  ADD COLUMN IF NOT EXISTS received_receiver_name text;

DROP POLICY IF EXISTS "Anyone can update transfers" ON public.transfers;
CREATE POLICY "Anyone can update transfers" ON public.transfers
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);