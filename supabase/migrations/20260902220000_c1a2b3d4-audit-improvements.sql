-- =========================================
-- 1) Detalle de quién contó y cuándo, guardado en cada renglón del corte
--    (closed_counts = "Cortes por categoría" en Historial de auditorías)
-- =========================================
ALTER TABLE public.closed_counts ADD COLUMN IF NOT EXISTS count_details jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.closed_counts ADD COLUMN IF NOT EXISTS last_counted_by text;
ALTER TABLE public.closed_counts ADD COLUMN IF NOT EXISTS last_counted_at timestamptz;

COMMENT ON COLUMN public.closed_counts.count_details IS
  'Array de aportes individuales al conteo: [{"name","branch","qty","at"}], tomado de audits al momento del cierre.';

-- =========================================
-- 2) Permitir al administrador editar (corregir) un renglón ya cerrado
--    de "Cortes por categoría", recalculando total/diferencia/valor.
-- =========================================
CREATE OR REPLACE FUNCTION public.admin_update_closed_count_row(
  p_admin_id uuid,
  p_admin_pin text,
  p_row_id uuid,
  p_mina_count numeric,
  p_morelos_count numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.closed_counts%ROWTYPE;
  v_total numeric;
  v_diff numeric;
  v_admin_name text;
BEGIN
  IF NOT public._check_admin_pin(p_admin_id, p_admin_pin) THEN
    RAISE EXCEPTION 'PIN de administrador inválido';
  END IF;
  IF p_mina_count < 0 OR p_morelos_count < 0 THEN
    RAISE EXCEPTION 'Las cantidades no pueden ser negativas';
  END IF;

  SELECT * INTO v_row FROM public.closed_counts WHERE id = p_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro no encontrado';
  END IF;

  SELECT name INTO v_admin_name FROM public.collaborators WHERE id = p_admin_id;

  v_total := p_mina_count + p_morelos_count;
  v_diff := v_total - v_row.system_stock;

  UPDATE public.closed_counts SET
    mina_count = p_mina_count,
    morelos_count = p_morelos_count,
    total_counted = v_total,
    difference = v_diff,
    difference_value = v_diff * v_row.unit_price,
    scanned_mina = p_mina_count > 0,
    scanned_morelos = p_morelos_count > 0,
    count_details = v_row.count_details || jsonb_build_array(
      jsonb_build_object(
        'name', COALESCE(v_admin_name, 'Admin'),
        'branch', 'editado',
        'qty', v_total,
        'at', now()
      )
    ),
    last_counted_by = COALESCE(v_admin_name, 'Admin'),
    last_counted_at = now()
  WHERE id = p_row_id;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_update_closed_count_row(uuid, text, uuid, numeric, numeric) TO anon, authenticated;

-- =========================================
-- 3) Marcar por sesión (categoría cerrada) si ya se corrigió en Zobaze.
--    El conteo permanece intacto en closed_counts; esto solo agrega
--    una marca de seguimiento por corte, para ver mes con mes la
--    reducción del faltante/sobrante ya corregido.
-- =========================================
CREATE TABLE IF NOT EXISTS public.zobaze_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE,
  category text NOT NULL,
  corrected boolean NOT NULL DEFAULT true,
  corrected_by text,
  corrected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.zobaze_corrections TO anon, authenticated;
GRANT ALL ON public.zobaze_corrections TO service_role;
ALTER TABLE public.zobaze_corrections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read zobaze corrections" ON public.zobaze_corrections
  FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.admin_set_zobaze_correction(
  p_admin_id uuid,
  p_admin_pin text,
  p_session_id uuid,
  p_category text,
  p_corrected boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_name text;
BEGIN
  IF NOT public._check_admin_pin(p_admin_id, p_admin_pin) THEN
    RAISE EXCEPTION 'PIN de administrador inválido';
  END IF;

  SELECT name INTO v_admin_name FROM public.collaborators WHERE id = p_admin_id;

  IF p_corrected THEN
    INSERT INTO public.zobaze_corrections (session_id, category, corrected, corrected_by, corrected_at)
    VALUES (p_session_id, p_category, true, v_admin_name, now())
    ON CONFLICT (session_id) DO UPDATE SET
      corrected = true, corrected_by = v_admin_name, corrected_at = now();
  ELSE
    DELETE FROM public.zobaze_corrections WHERE session_id = p_session_id;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_set_zobaze_correction(uuid, text, uuid, text, boolean) TO anon, authenticated;

-- =========================================
-- 4) Nada que migrar para "sin sucursal" del admin: collaborators.branch
--    ya es nullable (ver types.ts) — el cambio es solo de interfaz.
-- =========================================
