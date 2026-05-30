-- 1. Add payment policy to studios
ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS payment_policy TEXT NOT NULL DEFAULT 'pay_in_studio'
    CHECK (payment_policy IN ('pay_in_studio','pre_payment')),
  ADD COLUMN IF NOT EXISTS accepted_payment_methods TEXT[] NOT NULL DEFAULT ARRAY['mb_way','multibanco']::TEXT[];

-- 2. Add pending_payment to appointment_status enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'pending_payment'
                  AND enumtypid = 'public.appointment_status'::regtype) THEN
    ALTER TYPE public.appointment_status ADD VALUE 'pending_payment';
  END IF;
END $$;

-- 3. payment_intents table
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL,
  appointment_id UUID NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  client_secret TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'eur',
  method TEXT NOT NULL CHECK (method IN ('mb_way','multibanco')),
  status TEXT NOT NULL DEFAULT 'requires_action'
    CHECK (status IN ('requires_action','processing','succeeded','failed','expired','canceled')),
  multibanco_entity TEXT,
  multibanco_reference TEXT,
  hosted_voucher_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_appt ON public.payment_intents(appointment_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status_expires ON public.payment_intents(status, expires_at);

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read payment_intents" ON public.payment_intents;
CREATE POLICY "Members read payment_intents" ON public.payment_intents
  FOR SELECT TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id));

-- Service role manages (no policy needed; service_role bypasses RLS)

CREATE TRIGGER trg_payment_intents_updated_at
  BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Replace create_public_booking to support payment_policy
CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_studio_slug text,
  p_staff_id uuid,
  p_starts_at timestamp with time zone,
  p_service_ids uuid[],
  p_client_name text,
  p_client_phone text,
  p_client_email text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_studio_id UUID;
  v_payment_policy TEXT;
  v_client_id UUID;
  v_appt_id UUID;
  v_total_duration INTEGER := 0;
  v_total_price NUMERIC(10,2) := 0;
  v_ends_at TIMESTAMPTZ;
  v_svc RECORD;
  v_tz TEXT := 'Europe/Lisbon';
  v_local_start TIMESTAMP;
  v_available BOOLEAN;
  v_status appointment_status;
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  SELECT id, payment_policy INTO v_studio_id, v_payment_policy
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  PERFORM 1 FROM public.staff
   WHERE id = p_staff_id AND studio_id = v_studio_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(p_service_ids) AS requested(service_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.staff_services ss
      JOIN public.services s ON s.id = ss.service_id
      WHERE ss.staff_id = p_staff_id AND ss.service_id = requested.service_id
        AND s.studio_id = v_studio_id AND s.is_active = true
    )
  ) THEN RAISE EXCEPTION 'staff_cannot_perform_service'; END IF;

  FOR v_svc IN
    SELECT s.id, s.duration_min, s.price FROM public.services s
    WHERE s.id = ANY(p_service_ids) AND s.studio_id = v_studio_id AND s.is_active = true
  LOOP
    v_total_duration := v_total_duration + v_svc.duration_min;
    v_total_price := v_total_price + v_svc.price;
  END LOOP;

  IF v_total_duration = 0 THEN RAISE EXCEPTION 'invalid_services'; END IF;

  v_ends_at := p_starts_at + (v_total_duration || ' minutes')::INTERVAL;
  v_local_start := (p_starts_at AT TIME ZONE v_tz);

  SELECT EXISTS (
    SELECT 1 FROM public.get_available_slots(p_studio_slug, p_staff_id, v_local_start::date, v_total_duration, 15) slot
    WHERE slot.slot_start = p_starts_at
  ) INTO v_available;

  IF NOT v_available THEN RAISE EXCEPTION 'slot_unavailable'; END IF;

  INSERT INTO public.clients (studio_id, name, phone, email)
  VALUES (v_studio_id, trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''))
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, clients.email), updated_at = now()
  RETURNING id INTO v_client_id;

  v_status := CASE WHEN v_payment_policy = 'pre_payment' THEN 'pending_payment'::appointment_status
                   ELSE 'confirmed'::appointment_status END;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, v_status, v_total_price, v_total_duration, nullif(trim(coalesce(p_notes, '')), ''))
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, s.id, (row_number() OVER (ORDER BY array_position(p_service_ids, s.id)) > 1), s.price, s.duration_min
  FROM public.services s
  WHERE s.id = ANY(p_service_ids) AND s.studio_id = v_studio_id
  ORDER BY array_position(p_service_ids, s.id);

  RETURN jsonb_build_object(
    'appointment_id', v_appt_id,
    'studio_id', v_studio_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'total_price', v_total_price,
    'total_duration_min', v_total_duration,
    'requires_payment', v_payment_policy = 'pre_payment'
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END $function$;

-- 5. Expiration sweeper
CREATE OR REPLACE FUNCTION public.expire_pending_appointments()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count INTEGER;
BEGIN
  WITH expired AS (
    SELECT a.id FROM public.appointments a
    WHERE a.status = 'pending_payment'
      AND (
        NOT EXISTS (SELECT 1 FROM public.payment_intents pi WHERE pi.appointment_id = a.id)
        AND a.created_at < now() - interval '30 minutes'
      )
      OR EXISTS (
        SELECT 1 FROM public.payment_intents pi
        WHERE pi.appointment_id = a.id
          AND pi.status IN ('requires_action','processing')
          AND pi.expires_at IS NOT NULL
          AND pi.expires_at < now()
      )
  )
  UPDATE public.appointments SET status = 'cancelled', cancellation_reason = 'payment_expired', updated_at = now()
  WHERE id IN (SELECT id FROM expired) AND status = 'pending_payment';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.payment_intents SET status = 'expired', updated_at = now()
  WHERE status IN ('requires_action','processing') AND expires_at IS NOT NULL AND expires_at < now();

  RETURN v_count;
END $$;

-- 6. Cron job (every 5 min)
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$ BEGIN
  PERFORM cron.unschedule('expire-pending-appointments');
EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'expire-pending-appointments',
  '*/5 * * * *',
  $$ SELECT public.expire_pending_appointments(); $$
);