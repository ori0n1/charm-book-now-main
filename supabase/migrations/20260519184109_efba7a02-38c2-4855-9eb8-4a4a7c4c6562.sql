CREATE TABLE public.service_category_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.service_category_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read suggestions"
ON public.service_category_suggestions
FOR SELECT
TO anon, authenticated
USING (is_active = true);

INSERT INTO public.service_category_suggestions (label, sort_order) VALUES
  ('Cabelo', 10),
  ('Coloração', 20),
  ('Manicure', 30),
  ('Pedicure', 40),
  ('Unhas de gel', 50),
  ('Sobrancelhas', 60),
  ('Cílios', 70),
  ('Maquilhagem', 80),
  ('Depilação', 90),
  ('Estética facial', 100),
  ('Massagem', 110),
  ('Tratamentos corporais', 120);