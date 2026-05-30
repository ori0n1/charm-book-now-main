INSERT INTO public.service_category_suggestions (label, sort_order)
VALUES
  ('Cabelo', 10),
  ('Unhas', 20),
  ('Estética', 30),
  ('Sobrancelhas', 40),
  ('Pestanas', 50),
  ('Depilação', 60),
  ('Massagem', 70)
ON CONFLICT (label) DO UPDATE
SET sort_order = EXCLUDED.sort_order,
    is_active = true;

UPDATE public.service_category_suggestions
SET is_active = false
WHERE lower(label) IN (
  'coloração',
  'coloracao',
  'manicure',
  'pedicure',
  'unhas de gel',
  'estética facial',
  'estetica facial',
  'tratamentos corporais'
);
