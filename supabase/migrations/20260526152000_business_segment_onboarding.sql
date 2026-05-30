ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS business_segment TEXT NOT NULL DEFAULT 'beauty';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'studios_business_segment_check'
      AND conrelid = 'public.studios'::regclass
  ) THEN
    ALTER TABLE public.studios
      ADD CONSTRAINT studios_business_segment_check
      CHECK (business_segment IN ('beauty', 'barbershop', 'nail_studio', 'clinic', 'other'));
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.create_studio_with_owner(TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_studio_with_owner(
  p_name TEXT,
  p_slug TEXT,
  p_timezone TEXT DEFAULT 'Europe/Lisbon',
  p_currency TEXT DEFAULT 'EUR',
  p_business_segment TEXT DEFAULT 'beauty'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_studio_id UUID; v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_business_segment NOT IN ('beauty', 'barbershop', 'nail_studio', 'clinic', 'other') THEN
    RAISE EXCEPTION 'invalid_business_segment';
  END IF;

  INSERT INTO studios (name, slug, timezone, currency, business_segment)
  VALUES (p_name, p_slug, p_timezone, p_currency, p_business_segment)
  RETURNING id INTO v_studio_id;

  INSERT INTO user_roles (user_id, studio_id, role) VALUES (v_user, v_studio_id, 'studio_owner');
  RETURN v_studio_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_studio_with_owner(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
