-- Administrador: corregir por separado la existencia general del sistema
-- y el conteo físico guardado en el historial de auditorías.
-- No elimina ni reinicia auditorías existentes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.closed_count_correction_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closed_count_id uuid NOT NULL,
  barcode text NOT NULL,
  product_name text NOT NULL,
  admin_id uuid,
  admin_name text NOT NULL,
  old_system_stock numeric NOT NULL,
  new_system_stock numeric NOT NULL,
  old_mina_count numeric NOT NULL,
  new_mina_count numeric NOT NULL,
  old_morelos_count numeric NOT NULL,
  new_morelos_count numeric NOT NULL,
  corrected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.closed_count_correction_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.closed_count_correction_log
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.closed_count_correction_log TO service_role;

CREATE OR REPLACE FUNCTION public.admin_correct_closed_count_row(
  p_admin_id uuid,
  p_admin_pin text,
  p_row_id uuid,
  p_mina_count numeric,
  p_morelos_count numeric,
  p_system_stock numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.closed_counts%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_total_counted numeric;
  v_difference numeric;
  v_admin_name text;
  v_new_stock_a numeric;
  v_new_stock_b numeric;
BEGIN
  IF NOT public._check_admin_pin(p_admin_id, p_admin_pin) THEN
    RAISE EXCEPTION 'PIN de administrador inválido';
  END IF;

  IF p_mina_count IS NULL
     OR p_morelos_count IS NULL
     OR p_system_stock IS NULL
     OR p_mina_count < 0
     OR p_morelos_count < 0
     OR p_system_stock < 0
     OR p_mina_count <> trunc(p_mina_count)
     OR p_morelos_count <> trunc(p_morelos_count)
     OR p_system_stock <> trunc(p_system_stock) THEN
    RAISE EXCEPTION
      'Las cantidades deben ser números enteros iguales o mayores a cero';
  END IF;

  SELECT *
  INTO v_row
  FROM public.closed_counts
  WHERE id = p_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de auditoría no encontrado';
  END IF;

  SELECT *
  INTO v_product
  FROM public.products
  WHERE barcode = v_row.barcode
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'No se encontró el artículo en el inventario; no se guardó ningún cambio';
  END IF;

  SELECT name
  INTO v_admin_name
  FROM public.collaborators
  WHERE id = p_admin_id
    AND is_admin = true
    AND active = true;

  IF v_admin_name IS NULL THEN
    RAISE EXCEPTION
      'El administrador no está activo o no tiene permisos';
  END IF;

  -- Mantener la cantidad de la sucursal A siempre que quepa en el nuevo
  -- total. La diferencia se asigna a B; si el total nuevo es menor que A,
  -- se reduce A y B queda en cero.
  v_new_stock_a :=
    LEAST(COALESCE(v_product.stock_a, 0), p_system_stock);

  v_new_stock_b := p_system_stock - v_new_stock_a;

  UPDATE public.products
  SET stock_a = v_new_stock_a,
      stock_b = v_new_stock_b,
      updated_at = now()
  WHERE barcode = v_row.barcode;

  v_total_counted := p_mina_count + p_morelos_count;
  v_difference := v_total_counted - p_system_stock;

  INSERT INTO public.closed_count_correction_log (
    closed_count_id,
    barcode,
    product_name,
    admin_id,
    admin_name,
    old_system_stock,
    new_system_stock,
    old_mina_count,
    new_mina_count,
    old_morelos_count,
    new_morelos_count
  )
  VALUES (
    v_row.id,
    v_row.barcode,
    v_row.product_name,
    p_admin_id,
    v_admin_name,
    v_row.system_stock,
    p_system_stock,
    v_row.mina_count,
    p_mina_count,
    v_row.morelos_count,
    p_morelos_count
  );

  UPDATE public.closed_counts
  SET system_stock = p_system_stock,
      mina_count = p_mina_count,
      morelos_count = p_morelos_count,
      total_counted = v_total_counted,
      difference = v_difference,
      difference_value =
        v_difference * COALESCE(v_row.unit_price, 0),
      scanned_mina = p_mina_count > 0,
      scanned_morelos = p_morelos_count > 0,
      count_details =
        COALESCE(v_row.count_details, '[]'::jsonb)
        || jsonb_build_array(
          jsonb_build_object(
            'name', v_admin_name,
            'branch', 'corrección administrativa',
            'qty', v_total_counted,
            'at', now(),
            'system_stock_before', v_row.system_stock,
            'system_stock_after', p_system_stock
          )
        ),
      last_counted_by = v_admin_name,
      last_counted_at = now()
  WHERE id = p_row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_correct_closed_count_row(
  uuid, text, uuid, numeric, numeric, numeric
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_correct_closed_count_row(
  uuid, text, uuid, numeric, numeric, numeric
) TO anon, authenticated;

COMMIT;