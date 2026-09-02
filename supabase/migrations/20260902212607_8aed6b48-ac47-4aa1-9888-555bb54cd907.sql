ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price numeric NOT NULL DEFAULT 0;
ALTER TABLE public.closed_counts ADD COLUMN IF NOT EXISTS unit_price numeric NOT NULL DEFAULT 0;
ALTER TABLE public.closed_counts ADD COLUMN IF NOT EXISTS difference_value numeric NOT NULL DEFAULT 0;