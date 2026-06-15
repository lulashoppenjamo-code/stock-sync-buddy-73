
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enums
CREATE TYPE public.branch_code AS ENUM ('A', 'B');

-- =========================================
-- collaborators
-- =========================================
CREATE TABLE public.collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  pin_hash text NOT NULL,
  is_admin boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.collaborators TO service_role;
ALTER TABLE public.collaborators ENABLE ROW LEVEL SECURITY;
-- No direct access; everything goes through SECURITY DEFINER RPCs.

-- Public directory view (id, name, is_admin only)
CREATE OR REPLACE VIEW public.collaborator_directory
WITH (security_invoker = false) AS
SELECT id, name, is_admin, active FROM public.collaborators WHERE active = true;

GRANT SELECT ON public.collaborator_directory TO anon, authenticated;

-- =========================================
-- products
-- =========================================
CREATE TABLE public.products (
  barcode text PRIMARY KEY,
  product_name text NOT NULL,
  uom text,
  stock_a numeric NOT NULL DEFAULT 0,
  stock_b numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read products" ON public.products FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert products" ON public.products FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can update products" ON public.products FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete products" ON public.products FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX products_name_idx ON public.products USING gin (to_tsvector('simple', product_name));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE TRIGGER products_touch_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================
-- audits
-- =========================================
CREATE TABLE public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch public.branch_code NOT NULL,
  barcode text NOT NULL,
  product_name text NOT NULL,
  system_stock numeric NOT NULL,
  physical_count numeric NOT NULL,
  difference numeric NOT NULL,
  collaborator_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  collaborator_name text,
  client_uid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audits TO anon, authenticated;
GRANT ALL ON public.audits TO service_role;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read audits" ON public.audits FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert audits" ON public.audits FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX audits_created_idx ON public.audits (created_at DESC);

-- =========================================
-- transfers
-- =========================================
CREATE TABLE public.transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode text NOT NULL,
  product_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  origin public.branch_code NOT NULL,
  destination public.branch_code NOT NULL,
  sender_name text NOT NULL,
  receiver_name text NOT NULL,
  photo_url text NOT NULL,
  collaborator_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  collaborator_name text,
  client_uid text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (origin <> destination)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transfers TO anon, authenticated;
GRANT ALL ON public.transfers TO service_role;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read transfers" ON public.transfers FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert transfers" ON public.transfers FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX transfers_created_idx ON public.transfers (created_at DESC);

-- =========================================
-- csv_imports
-- =========================================
CREATE TABLE public.csv_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text,
  new_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  collaborator_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  collaborator_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.csv_imports TO anon, authenticated;
GRANT ALL ON public.csv_imports TO service_role;
ALTER TABLE public.csv_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read csv imports" ON public.csv_imports FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert csv imports" ON public.csv_imports FOR INSERT TO anon, authenticated WITH CHECK (true);

-- =========================================
-- RPC: verify PIN
-- =========================================
CREATE OR REPLACE FUNCTION public.verify_pin(p_collaborator_id uuid, p_pin text)
RETURNS TABLE (id uuid, name text, is_admin boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.name, c.is_admin
  FROM public.collaborators c
  WHERE c.id = p_collaborator_id
    AND c.active = true
    AND c.pin_hash = crypt(p_pin, c.pin_hash);
END $$;

GRANT EXECUTE ON FUNCTION public.verify_pin(uuid, text) TO anon, authenticated;

-- =========================================
-- RPC: admin manages collaborators (requires admin PIN)
-- =========================================
CREATE OR REPLACE FUNCTION public._check_admin_pin(p_admin_id uuid, p_admin_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.collaborators
    WHERE id = p_admin_id
      AND is_admin = true
      AND active = true
      AND pin_hash = crypt(p_admin_pin, pin_hash)
  ) INTO ok;
  RETURN ok;
END $$;

CREATE OR REPLACE FUNCTION public.admin_create_collaborator(
  p_admin_id uuid,
  p_admin_pin text,
  p_name text,
  p_pin text,
  p_is_admin boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT public._check_admin_pin(p_admin_id, p_admin_pin) THEN
    RAISE EXCEPTION 'PIN de administrador inválido';
  END IF;
  IF length(p_pin) < 4 THEN
    RAISE EXCEPTION 'El PIN debe tener al menos 4 dígitos';
  END IF;
  INSERT INTO public.collaborators (name, pin_hash, is_admin)
  VALUES (p_name, crypt(p_pin, gen_salt('bf')), p_is_admin)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_create_collaborator(uuid, text, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_collaborator(
  p_admin_id uuid,
  p_admin_pin text,
  p_target_id uuid,
  p_name text,
  p_pin text,
  p_is_admin boolean,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._check_admin_pin(p_admin_id, p_admin_pin) THEN
    RAISE EXCEPTION 'PIN de administrador inválido';
  END IF;
  UPDATE public.collaborators SET
    name = COALESCE(p_name, name),
    is_admin = COALESCE(p_is_admin, is_admin),
    active = COALESCE(p_active, active),
    pin_hash = CASE WHEN p_pin IS NOT NULL AND length(p_pin) >= 4
                     THEN crypt(p_pin, gen_salt('bf'))
                     ELSE pin_hash END
  WHERE id = p_target_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_update_collaborator(uuid, text, uuid, text, text, boolean, boolean) TO anon, authenticated;

-- =========================================
-- RPC: atomic transfer
-- =========================================
CREATE OR REPLACE FUNCTION public.apply_transfer(
  p_barcode text,
  p_quantity numeric,
  p_origin public.branch_code,
  p_destination public.branch_code,
  p_sender_name text,
  p_receiver_name text,
  p_photo_url text,
  p_collaborator_id uuid,
  p_collaborator_name text,
  p_client_uid text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_transfer_id uuid;
  v_origin_stock numeric;
BEGIN
  IF p_origin = p_destination THEN
    RAISE EXCEPTION 'Origen y destino deben ser distintos';
  END IF;
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'La cantidad debe ser mayor a cero';
  END IF;

  -- Idempotency: if same client_uid already applied, return existing id
  IF p_client_uid IS NOT NULL THEN
    SELECT id INTO v_transfer_id FROM public.transfers WHERE client_uid = p_client_uid;
    IF v_transfer_id IS NOT NULL THEN
      RETURN v_transfer_id;
    END IF;
  END IF;

  SELECT * INTO v_product FROM public.products WHERE barcode = p_barcode FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado: %', p_barcode;
  END IF;

  v_origin_stock := CASE WHEN p_origin = 'A' THEN v_product.stock_a ELSE v_product.stock_b END;
  IF v_origin_stock < p_quantity THEN
    RAISE EXCEPTION 'Stock insuficiente en sucursal %: % disponibles', p_origin, v_origin_stock;
  END IF;

  IF p_origin = 'A' THEN
    UPDATE public.products SET stock_a = stock_a - p_quantity, stock_b = stock_b + p_quantity WHERE barcode = p_barcode;
  ELSE
    UPDATE public.products SET stock_b = stock_b - p_quantity, stock_a = stock_a + p_quantity WHERE barcode = p_barcode;
  END IF;

  INSERT INTO public.transfers (
    barcode, product_name, quantity, origin, destination,
    sender_name, receiver_name, photo_url,
    collaborator_id, collaborator_name, client_uid
  )
  VALUES (
    p_barcode, v_product.product_name, p_quantity, p_origin, p_destination,
    p_sender_name, p_receiver_name, p_photo_url,
    p_collaborator_id, p_collaborator_name, p_client_uid
  )
  RETURNING id INTO v_transfer_id;

  RETURN v_transfer_id;
END $$;

GRANT EXECUTE ON FUNCTION public.apply_transfer(text, numeric, public.branch_code, public.branch_code, text, text, text, uuid, text, text) TO anon, authenticated;

-- =========================================
-- Seed: default admin collaborator (PIN 1234)
-- =========================================
INSERT INTO public.collaborators (name, pin_hash, is_admin)
VALUES ('Admin', crypt('1234', gen_salt('bf')), true)
ON CONFLICT (name) DO NOTHING;

-- =========================================
-- Realtime
-- =========================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.transfers;
