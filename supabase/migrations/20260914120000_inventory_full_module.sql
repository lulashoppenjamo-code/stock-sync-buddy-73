-- ============================================================
-- MÓDULO: Inventario Físico Completo
-- ============================================================
-- Este archivo SOLO AGREGA tablas y funciones nuevas.
-- No modifica products, audits, transfers, closed_counts,
-- audit_history, branch_closures, audit_comments, categories
-- ni collaborators.
--
-- Regla de negocio (NO se toca): existencia teórica global de un
-- producto = stock_a + stock_b. stock_a/stock_b son UBICACIÓN
-- física, no inventarios independientes.
--
-- Al finalizar una sesión, este módulo escribe filas en la tabla
-- existente `closed_counts` (misma tabla que usa hoy el cierre
-- por categoría) con category = '📦 INVENTARIO GLOBAL', para que
-- el Historial de auditorías y el reporte mensual de faltantes/
-- sobrantes en pesos (app.audit-history.tsx) muestren estos
-- inventarios sin necesitar ningún cambio en ese archivo.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1) inventory_sessions — una sesión = un inventario físico
--    completo, puede durar varios días.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.inventory_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'finished')),
  started_at timestamptz NOT NULL DEFAULT now(),
  started_by_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  started_by_name text,
  finished_at timestamptz,
  finished_by_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  finished_by_name text,
  total_products integer NOT NULL DEFAULT 0,
  notes text
);

-- Solo puede haber UNA sesión abierta a la vez (evita crear dos
-- inventarios globales simultáneos por error).
CREATE UNIQUE INDEX inventory_sessions_one_open_idx
  ON public.inventory_sessions ((status))
  WHERE status = 'in_progress';

GRANT SELECT, INSERT, UPDATE ON public.inventory_sessions TO anon, authenticated;
GRANT ALL ON public.inventory_sessions TO service_role;
ALTER TABLE public.inventory_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read inventory_sessions" ON public.inventory_sessions
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert inventory_sessions" ON public.inventory_sessions
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can update inventory_sessions" ON public.inventory_sessions
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 2) inventory_session_items — un renglón por producto dentro
--    de una sesión. UNIQUE(session_id, barcode) evita duplicados
--    aunque el mismo código se escanee muchas veces o desde dos
--    tablets distintas.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.inventory_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.inventory_sessions(id) ON DELETE CASCADE,
  barcode text NOT NULL,
  product_name text NOT NULL,
  category text,
  -- Congelados al iniciar la sesión (o al detectar el producto por
  -- primera vez dentro de la sesión). No se recalculan al cerrar.
  system_stock_snapshot numeric NOT NULL DEFAULT 0,  -- stock_a + stock_b
  unit_cost_snapshot numeric NOT NULL DEFAULT 0,      -- products.price
  -- Piezas contadas físicamente, separadas por dónde se contaron
  -- (metadata de ubicación), pero SIEMPRE se auditan sumadas.
  mina_count numeric NOT NULL DEFAULT 0,
  morelos_count numeric NOT NULL DEFAULT 0,
  physical_count numeric GENERATED ALWAYS AS (mina_count + morelos_count) STORED,
  difference numeric GENERATED ALWAYS AS ((mina_count + morelos_count) - system_stock_snapshot) STORED,
  -- false = PENDIENTE real (nunca tocado). true = ya se contó al
  -- menos una vez (aunque el resultado parcial sea 0).
  touched boolean NOT NULL DEFAULT false,
  counted_by text,
  counted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, barcode)
);

GRANT SELECT, INSERT, UPDATE ON public.inventory_session_items TO anon, authenticated;
GRANT ALL ON public.inventory_session_items TO service_role;
ALTER TABLE public.inventory_session_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read inventory_session_items" ON public.inventory_session_items
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert inventory_session_items" ON public.inventory_session_items
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can update inventory_session_items" ON public.inventory_session_items
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE INDEX inventory_session_items_session_idx ON public.inventory_session_items (session_id);
CREATE INDEX inventory_session_items_barcode_idx ON public.inventory_session_items (barcode);
CREATE INDEX inventory_session_items_pending_idx ON public.inventory_session_items (session_id) WHERE touched = false;
CREATE INDEX inventory_session_items_diff_idx ON public.inventory_session_items (session_id, difference);

-- ─────────────────────────────────────────────────────────────
-- 3) inventory_scan_events — bitácora de idempotencia. Cada
--    conteo enviado desde la cola offline trae un client_uid
--    único; si el mismo evento llega dos veces (reintento de
--    sincronización), la segunda vez se ignora sin duplicar el
--    conteo. Mismo patrón que ya usan `audits` y `transfers`
--    con su columna client_uid.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE public.inventory_scan_events (
  client_uid text PRIMARY KEY,
  session_id uuid NOT NULL,
  barcode text NOT NULL,
  location text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('increment', 'set')),
  delta numeric,
  quantity numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.inventory_scan_events TO anon, authenticated;
GRANT ALL ON public.inventory_scan_events TO service_role;
ALTER TABLE public.inventory_scan_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read inventory_scan_events" ON public.inventory_scan_events
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can insert inventory_scan_events" ON public.inventory_scan_events
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- 4) create_inventory_session
--    Crea la sesión y AL MISMO TIEMPO guarda la fotografía de la
--    existencia teórica global (stock_a+stock_b) y el costo
--    (price) de TODO el catálogo. Esto es lo que permite que
--    ventas/compras/transferencias posteriores no alteren la
--    base contra la que se está auditando.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_inventory_session(
  p_started_by_id uuid,
  p_started_by_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.inventory_sessions WHERE status = 'in_progress') THEN
    RAISE EXCEPTION 'Ya existe un inventario físico en progreso. Continuá ese antes de crear uno nuevo.';
  END IF;

  INSERT INTO public.inventory_sessions (started_by_id, started_by_name)
  VALUES (p_started_by_id, p_started_by_name)
  RETURNING id INTO v_id;

  INSERT INTO public.inventory_session_items (
    session_id, barcode, product_name, category, system_stock_snapshot, unit_cost_snapshot
  )
  SELECT v_id, p.barcode, p.product_name, p.category, p.stock_a + p.stock_b, p.price
  FROM public.products p;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  UPDATE public.inventory_sessions SET total_products = v_count WHERE id = v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_inventory_session(uuid, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 5) inventory_scan — ESCANEAR → +delta (normalmente +1) en la
--    ubicación indicada. Atómico (bloquea el renglón) para que
--    dos tablets contando el mismo producto a la vez no se
--    pisen ni se pierda un conteo.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inventory_scan(
  p_session_id uuid,
  p_barcode text,
  p_location public.branch_code,
  p_delta numeric,
  p_collaborator_name text,
  p_client_uid text
)
RETURNS TABLE (
  barcode text,
  product_name text,
  system_stock_snapshot numeric,
  mina_count numeric,
  morelos_count numeric,
  physical_count numeric,
  difference numeric,
  touched boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_product public.products%ROWTYPE;
  v_apply boolean := true;
BEGIN
  SELECT status INTO v_status FROM public.inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Sesión de inventario no encontrada';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Este inventario ya fue finalizado, no se pueden registrar más conteos';
  END IF;

  -- Idempotencia para reintentos de sincronización offline.
  IF p_client_uid IS NOT NULL THEN
    INSERT INTO public.inventory_scan_events (client_uid, session_id, barcode, location, delta, mode)
    VALUES (p_client_uid, p_session_id, p_barcode, p_location::text, p_delta, 'increment')
    ON CONFLICT (client_uid) DO NOTHING;
    IF NOT FOUND THEN
      v_apply := false;
    END IF;
  END IF;

  IF v_apply THEN
    -- Si el producto no estaba en la sesión (se dio de alta después
    -- de iniciar el inventario), lo agregamos con su stock/costo
    -- ACTUAL en este momento (no hay snapshot previo posible).
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_session_items WHERE session_id = p_session_id AND barcode = p_barcode
    ) THEN
      SELECT * INTO v_product FROM public.products WHERE barcode = p_barcode;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado: %', p_barcode;
      END IF;
      INSERT INTO public.inventory_session_items (
        session_id, barcode, product_name, category, system_stock_snapshot, unit_cost_snapshot
      )
      VALUES (
        p_session_id, v_product.barcode, v_product.product_name, v_product.category,
        v_product.stock_a + v_product.stock_b, v_product.price
      )
      ON CONFLICT (session_id, barcode) DO NOTHING;
    END IF;

    IF p_location = 'A' THEN
      UPDATE public.inventory_session_items
        SET mina_count = mina_count + p_delta, touched = true,
            counted_by = p_collaborator_name, counted_at = now()
        WHERE session_id = p_session_id AND barcode = p_barcode;
    ELSE
      UPDATE public.inventory_session_items
        SET morelos_count = morelos_count + p_delta, touched = true,
            counted_by = p_collaborator_name, counted_at = now()
        WHERE session_id = p_session_id AND barcode = p_barcode;
    END IF;
  END IF;

  RETURN QUERY
  SELECT i.barcode, i.product_name, i.system_stock_snapshot, i.mina_count, i.morelos_count,
         i.physical_count, i.difference, i.touched
  FROM public.inventory_session_items i
  WHERE i.session_id = p_session_id AND i.barcode = p_barcode;
END $$;

GRANT EXECUTE ON FUNCTION public.inventory_scan(uuid, text, public.branch_code, numeric, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6) inventory_manual_set — escribir la cantidad exacta contada
--    (reemplaza, no suma) para la ubicación indicada.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inventory_manual_set(
  p_session_id uuid,
  p_barcode text,
  p_location public.branch_code,
  p_quantity numeric,
  p_collaborator_name text,
  p_client_uid text
)
RETURNS TABLE (
  barcode text,
  product_name text,
  system_stock_snapshot numeric,
  mina_count numeric,
  morelos_count numeric,
  physical_count numeric,
  difference numeric,
  touched boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_product public.products%ROWTYPE;
  v_apply boolean := true;
BEGIN
  IF p_quantity < 0 THEN
    RAISE EXCEPTION 'La cantidad no puede ser negativa';
  END IF;

  SELECT status INTO v_status FROM public.inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Sesión de inventario no encontrada';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Este inventario ya fue finalizado';
  END IF;

  IF p_client_uid IS NOT NULL THEN
    INSERT INTO public.inventory_scan_events (client_uid, session_id, barcode, location, quantity, mode)
    VALUES (p_client_uid, p_session_id, p_barcode, p_location::text, p_quantity, 'set')
    ON CONFLICT (client_uid) DO NOTHING;
    IF NOT FOUND THEN
      v_apply := false;
    END IF;
  END IF;

  IF v_apply THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory_session_items WHERE session_id = p_session_id AND barcode = p_barcode
    ) THEN
      SELECT * INTO v_product FROM public.products WHERE barcode = p_barcode;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Producto no encontrado: %', p_barcode;
      END IF;
      INSERT INTO public.inventory_session_items (
        session_id, barcode, product_name, category, system_stock_snapshot, unit_cost_snapshot
      )
      VALUES (
        p_session_id, v_product.barcode, v_product.product_name, v_product.category,
        v_product.stock_a + v_product.stock_b, v_product.price
      )
      ON CONFLICT (session_id, barcode) DO NOTHING;
    END IF;

    IF p_location = 'A' THEN
      UPDATE public.inventory_session_items
        SET mina_count = p_quantity, touched = true,
            counted_by = p_collaborator_name, counted_at = now()
        WHERE session_id = p_session_id AND barcode = p_barcode;
    ELSE
      UPDATE public.inventory_session_items
        SET morelos_count = p_quantity, touched = true,
            counted_by = p_collaborator_name, counted_at = now()
        WHERE session_id = p_session_id AND barcode = p_barcode;
    END IF;
  END IF;

  RETURN QUERY
  SELECT i.barcode, i.product_name, i.system_stock_snapshot, i.mina_count, i.morelos_count,
         i.physical_count, i.difference, i.touched
  FROM public.inventory_session_items i
  WHERE i.session_id = p_session_id AND i.barcode = p_barcode;
END $$;

GRANT EXECUTE ON FUNCTION public.inventory_manual_set(uuid, text, public.branch_code, numeric, text, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 7) finalize_inventory_session — cierre explícito e inmutable.
--    Vuelca el resultado a `closed_counts` (misma tabla del
--    historial actual) con category = '📦 INVENTARIO GLOBAL', y
--    marca la sesión como finished. A partir de ahí, inventory_scan
--    e inventory_manual_set rechazan cualquier cambio sobre esta
--    sesión (inmutabilidad histórica).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_inventory_session(
  p_session_id uuid,
  p_finished_by_id uuid,
  p_finished_by_name text
)
RETURNS TABLE (
  products_total integer,
  counted integer,
  pending integer,
  coincide integer,
  faltante integer,
  sobrante integer,
  valor_teorico numeric,
  valor_fisico numeric,
  perdida_neta numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_now timestamptz := now();
BEGIN
  SELECT status INTO v_status FROM public.inventory_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Sesión de inventario no encontrada';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'Este inventario ya fue finalizado';
  END IF;

  INSERT INTO public.closed_counts (
    session_id, category, barcode, product_name, system_stock,
    mina_count, morelos_count, total_counted, difference,
    unit_price, difference_value, scanned_mina, scanned_morelos,
    closed_by, closed_at, count_details, last_counted_by, last_counted_at
  )
  SELECT
    i.session_id, '📦 INVENTARIO GLOBAL', i.barcode, i.product_name, i.system_stock_snapshot,
    i.mina_count, i.morelos_count, i.physical_count, i.difference,
    i.unit_cost_snapshot, i.difference * i.unit_cost_snapshot,
    i.mina_count > 0, i.morelos_count > 0,
    p_finished_by_name, v_now, '[]'::jsonb, i.counted_by, i.counted_at
  FROM public.inventory_session_items i
  WHERE i.session_id = p_session_id;

  UPDATE public.inventory_sessions
    SET status = 'finished', finished_at = v_now,
        finished_by_id = p_finished_by_id, finished_by_name = p_finished_by_name
    WHERE id = p_session_id;

  RETURN QUERY
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE touched)::integer,
    count(*) FILTER (WHERE NOT touched)::integer,
    count(*) FILTER (WHERE difference = 0)::integer,
    count(*) FILTER (WHERE difference < 0)::integer,
    count(*) FILTER (WHERE difference > 0)::integer,
    coalesce(sum(system_stock_snapshot * unit_cost_snapshot), 0),
    coalesce(sum(physical_count * unit_cost_snapshot), 0),
    coalesce(sum(difference * unit_cost_snapshot), 0)
  FROM public.inventory_session_items
  WHERE session_id = p_session_id;
END $$;

GRANT EXECUTE ON FUNCTION public.finalize_inventory_session(uuid, uuid, text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8) Realtime — para que el progreso se vea en vivo entre dos
--    tablets contando al mismo tiempo (mismo mecanismo que ya
--    usan products/audits/transfers).
-- ─────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_session_items;
