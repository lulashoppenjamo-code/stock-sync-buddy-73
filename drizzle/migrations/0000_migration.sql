CREATE OR REPLACE FUNCTION public.admin_wipe_audit_category(
  p_admin_id uuid, p_admin_pin text, p_category text,
  p_since timestamptz, p_until timestamptz, p_period date, p_zero_stock boolean
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_cat text := trim(coalesce(p_category, ''));
  v_barcodes text[];
  v_total integer := 0;
  v_n integer;
BEGIN
  IF NOT public._check_admin_pin(p_admin_id, p_admin_pin) THEN
    RAISE EXCEPTION 'PIN de administrador inválido';
  END IF;
  IF v_cat = '' THEN RAISE EXCEPTION 'Categoría vacía'; END IF;

  SELECT coalesce(array_agg(barcode), '{}') INTO v_barcodes
  FROM public.products WHERE trim(coalesce(category, '')) = v_cat;

  DELETE FROM public.audits WHERE barcode = ANY(v_barcodes)
    AND created_at >= p_since AND created_at <= p_until;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  DELETE FROM public.audit_history WHERE trim(category) = v_cat
    AND created_at >= p_since AND created_at <= p_until;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  DELETE FROM public.closed_counts WHERE trim(category) = v_cat
    AND closed_at >= p_since AND closed_at <= p_until;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_total := v_total + v_n;

  DELETE FROM public.branch_closures WHERE trim(category) = v_cat AND period = p_period;

  IF p_zero_stock THEN
    UPDATE public.products SET stock_a = 0, stock_b = 0, updated_at = now()
    WHERE barcode = ANY(v_barcodes);
  END IF;

  RETURN v_total;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_wipe_audit_category(uuid, text, text, timestamptz, timestamptz, date, boolean) TO anon, authenticated;