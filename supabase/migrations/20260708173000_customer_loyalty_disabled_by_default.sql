-- Customer loyalty is optional per studio. New settings must never be enabled
-- automatically by public/client reads.

ALTER TABLE public.customer_loyalty_settings
  ALTER COLUMN enabled SET DEFAULT false;

CREATE OR REPLACE FUNCTION public.ensure_customer_loyalty_settings(p_studio_id uuid)
RETURNS public.customer_loyalty_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_settings public.customer_loyalty_settings%ROWTYPE;
BEGIN
  INSERT INTO public.customer_loyalty_settings (studio_id, enabled)
  VALUES (p_studio_id, false)
  ON CONFLICT (studio_id) DO NOTHING;

  SELECT * INTO v_settings
  FROM public.customer_loyalty_settings
  WHERE studio_id = p_studio_id;

  RETURN v_settings;
END;
$function$;

-- Rows created by the old default without a later explicit settings save should
-- be considered inactive. Explicit saves update updated_at independently.
UPDATE public.customer_loyalty_settings
SET enabled = false,
    updated_at = now()
WHERE enabled = true
  AND created_at = updated_at;
