ALTER TABLE public.studios
ADD COLUMN IF NOT EXISTS hero_gallery_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
