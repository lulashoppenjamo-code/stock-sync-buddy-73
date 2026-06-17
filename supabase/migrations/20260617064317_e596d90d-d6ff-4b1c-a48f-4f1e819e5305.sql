ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text;
CREATE INDEX IF NOT EXISTS products_category_idx ON public.products (category);