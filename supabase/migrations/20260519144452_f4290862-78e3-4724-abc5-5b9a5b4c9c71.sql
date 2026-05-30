-- Booking payment requests: stores a temporary checkout request before a real appointment exists.
CREATE TABLE IF NOT EXISTS public.booking_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  service_ids UUID[] NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  total_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_duration_min INTEGER NOT NULL DEFAULT 0,
  client_name TEXT NOT NULL,
  client_phone TEXT NOT NULL,
  client_email TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment','processing','paid','converted','expired','failed','canceled','paid_conflict')),
  failure_reason TEXT,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (array_length(service_ids, 1) IS NOT NULL),
  CHECK (total_price >= 0),
  CHECK (total_duration_min > 0)
);

CREATE INDEX IF NOT EXISTS idx_booking_payment_requests_studio ON public.booking_payment_requests(studio_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_booking_payment_requests_status_expires ON public.booking_payment_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_payment_requests_staff_range ON public.booking_payment_requests USING gist (
  staff_id,
  tstzrange(starts_at, ends_at, '[)')
) WHERE (status IN ('awaiting_payment','processing','paid') AND expires_at > '2000-01-01'::timestamptz);

ALTER TABLE public.booking_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read booking payment requests" ON public.booking_payment_requests;
CREATE POLICY "Members read booking payment requests" ON public.booking_payment_requests
  FOR SELECT TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id));

DROP TRIGGER IF EXISTS trg_booking_payment_requests_updated_at ON public.booking_payment_requests;
CREATE TRIGGER trg_booking_payment_requests_updated_at
  BEFORE UPDATE ON public.booking_payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Payment intents can now belong either to an already-created legacy appointment or to a checkout request.
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS booking_request_id UUID REFERENCES public.booking_payment_requests(id) ON DELETE SET NULL;

ALTER TABLE public.payment_intents
  ALTER COLUMN appointment_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_request ON public.payment_intents(booking_request_id);

-- Let the app reliably create/update the signed-in user's profile without relying on auth-schema triggers.
DROP POLICY IF EXISTS "Users create own profile" ON public.profiles;
CREATE POLICY "Users create own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- New availability function also treats active checkout requests as temporary holds.
CREATE OR REPLACE FUNCTION public.get_available_slots(p_studio_slug text, p_staff_id uuid, p_date date, p_duration_min integer, p_slot_step_min integer DEFAULT 15)
 RETURNS TABLE(staff_id uuid, slot_start timestamp with time zone, slot_label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_studio_id UUID;
  v_tz TEXT := 'Europe/Lisbon';
  v_weekday INT;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_duration_min IS NULL OR p_duration_min <= 0 OR p_duration_min > 720 THEN
    RETURN;
  END IF;

  IF p_slot_step_min IS NULL OR p_slot_step_min <= 0 OR p_slot_step_min > 120 THEN
    p_slot_step_min := 15;
  END IF;

  SELECT id INTO v_studio_id
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;

  IF v_studio_id IS NULL THEN
    RETURN;
  END IF;

  v_weekday := EXTRACT(DOW FROM p_date)::INT;

  RETURN QUERY
  WITH eligible_staff AS (
    SELECT s.id
    FROM public.staff s
    WHERE s.studio_id = v_studio_id
      AND s.is_active = true
      AND (p_staff_id IS NULL OR s.id = p_staff_id)
  ),
  windows AS (
    SELECT sa.staff_id, sa.start_time, sa.end_time
    FROM public.staff_availability sa
    JOIN eligible_staff es ON es.id = sa.staff_id
    WHERE sa.studio_id = v_studio_id
      AND sa.weekday = v_weekday
      AND sa.end_time > sa.start_time
      AND (sa.end_time - (p_duration_min || ' minutes')::INTERVAL) >= sa.start_time
  ),
  candidates AS (
    SELECT
      w.staff_id,
      ((p_date::timestamp + (slot.local_ts::time)) AT TIME ZONE v_tz) AS slot_start_ts,
      slot.local_ts::time AS slot_t
    FROM windows w
    CROSS JOIN LATERAL generate_series(
      p_date::timestamp + w.start_time,
      p_date::timestamp + w.end_time - (p_duration_min || ' minutes')::INTERVAL,
      (p_slot_step_min || ' minutes')::INTERVAL
    ) AS slot(local_ts)
  )
  SELECT
    c.staff_id,
    c.slot_start_ts AS slot_start,
    to_char(c.slot_t, 'HH24:MI') AS slot_label
  FROM candidates c
  WHERE c.slot_start_ts > v_now
    AND NOT EXISTS (
      SELECT 1
      FROM public.staff_time_off t
      WHERE t.staff_id = c.staff_id
        AND tstzrange(t.starts_at, t.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::INTERVAL, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.appointments a
      WHERE a.staff_id = c.staff_id
        AND a.status NOT IN ('cancelled','no_show')
        AND tstzrange(a.starts_at, a.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::INTERVAL, '[)')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.booking_payment_requests bpr
      WHERE bpr.staff_id = c.staff_id
        AND bpr.status IN ('awaiting_payment','processing','paid')
        AND bpr.expires_at > now()
        AND tstzrange(bpr.starts_at, bpr.ends_at, '[)') &&
            tstzrange(c.slot_start_ts, c.slot_start_ts + (p_duration_min || ' minutes')::INTERVAL, '[)')
    )
  ORDER BY c.slot_start_ts, c.staff_id;
END
$function$;

-- Public booking now creates a temporary checkout request for prepaid studios; appointments are created only after payment succeeds.
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
  v_request_id UUID;
  v_total_duration INTEGER := 0;
  v_total_price NUMERIC(10,2) := 0;
  v_ends_at TIMESTAMPTZ;
  v_svc RECORD;
  v_tz TEXT := 'Europe/Lisbon';
  v_local_start TIMESTAMP;
  v_available BOOLEAN;
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN RAISE EXCEPTION 'invalid_name'; END IF;
  IF p_client_phone IS NULL OR length(regexp_replace(trim(p_client_phone), '\D', '', 'g')) < 9 THEN RAISE EXCEPTION 'invalid_phone'; END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN RAISE EXCEPTION 'no_services'; END IF;

  SELECT id, payment_policy INTO v_studio_id, v_payment_policy
  FROM public.studios
  WHERE slug = p_studio_slug AND is_active = true;
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  UPDATE public.booking_payment_requests
  SET status = 'expired', failure_reason = COALESCE(failure_reason, 'checkout_expired'), updated_at = now()
  WHERE studio_id = v_studio_id
    AND status IN ('awaiting_payment','processing')
    AND expires_at <= now();

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

  IF v_payment_policy = 'pre_payment' THEN
    INSERT INTO public.booking_payment_requests (
      studio_id, staff_id, service_ids, starts_at, ends_at, total_price, total_duration_min,
      client_name, client_phone, client_email, notes, status, expires_at
    ) VALUES (
      v_studio_id, p_staff_id, p_service_ids, p_starts_at, v_ends_at, v_total_price, v_total_duration,
      trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''),
      nullif(trim(coalesce(p_notes, '')), ''), 'awaiting_payment', now() + interval '30 minutes'
    ) RETURNING id INTO v_request_id;

    RETURN jsonb_build_object(
      'booking_request_id', v_request_id,
      'appointment_id', NULL,
      'studio_id', v_studio_id,
      'starts_at', p_starts_at,
      'ends_at', v_ends_at,
      'total_price', v_total_price,
      'total_duration_min', v_total_duration,
      'requires_payment', true,
      'reservation_status', 'awaiting_payment',
      'payment_status', 'not_started'
    );
  END IF;

  INSERT INTO public.clients (studio_id, name, phone, email)
  VALUES (v_studio_id, trim(p_client_name), trim(p_client_phone), nullif(trim(coalesce(p_client_email, '')), ''))
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, clients.email), updated_at = now()
  RETURNING id INTO v_client_id;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed', v_total_price, v_total_duration, nullif(trim(coalesce(p_notes, '')), ''))
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, s.id, (row_number() OVER (ORDER BY array_position(p_service_ids, s.id)) > 1), s.price, s.duration_min
  FROM public.services s
  WHERE s.id = ANY(p_service_ids) AND s.studio_id = v_studio_id
  ORDER BY array_position(p_service_ids, s.id);

  RETURN jsonb_build_object(
    'appointment_id', v_appt_id,
    'booking_request_id', NULL,
    'studio_id', v_studio_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'total_price', v_total_price,
    'total_duration_min', v_total_duration,
    'requires_payment', false,
    'reservation_status', 'confirmed',
    'payment_status', 'pay_in_studio'
  );
EXCEPTION
  WHEN exclusion_violation THEN RAISE EXCEPTION 'slot_unavailable';
END $function$;

-- Converts a paid checkout request into the real confirmed appointment.
CREATE OR REPLACE FUNCTION public.confirm_paid_booking_request(
  p_request_id UUID,
  p_stripe_payment_intent_id TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req public.booking_payment_requests%ROWTYPE;
  v_client_id UUID;
  v_appt_id UUID;
BEGIN
  SELECT * INTO v_req
  FROM public.booking_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'booking_request_not_found'; END IF;

  IF v_req.status = 'converted' AND v_req.appointment_id IS NOT NULL THEN
    RETURN v_req.appointment_id;
  END IF;

  IF v_req.status IN ('expired','failed','canceled','paid_conflict') THEN
    RAISE EXCEPTION 'booking_request_not_payable';
  END IF;

  UPDATE public.booking_payment_requests
  SET status = 'paid', updated_at = now()
  WHERE id = v_req.id;

  INSERT INTO public.clients (studio_id, name, phone, email)
  VALUES (v_req.studio_id, trim(v_req.client_name), trim(v_req.client_phone), nullif(trim(coalesce(v_req.client_email, '')), ''))
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, clients.email), updated_at = now()
  RETURNING id INTO v_client_id;

  INSERT INTO public.appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_req.studio_id, v_req.staff_id, v_client_id, v_req.starts_at, v_req.ends_at, 'confirmed', v_req.total_price, v_req.total_duration_min, v_req.notes)
  RETURNING id INTO v_appt_id;

  INSERT INTO public.appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, s.id, (row_number() OVER (ORDER BY array_position(v_req.service_ids, s.id)) > 1), s.price, s.duration_min
  FROM public.services s
  WHERE s.id = ANY(v_req.service_ids) AND s.studio_id = v_req.studio_id
  ORDER BY array_position(v_req.service_ids, s.id);

  UPDATE public.booking_payment_requests
  SET status = 'converted', appointment_id = v_appt_id, updated_at = now()
  WHERE id = v_req.id;

  IF p_stripe_payment_intent_id IS NOT NULL THEN
    UPDATE public.payment_intents
    SET appointment_id = v_appt_id, updated_at = now()
    WHERE stripe_payment_intent_id = p_stripe_payment_intent_id;
  END IF;

  RETURN v_appt_id;
EXCEPTION
  WHEN exclusion_violation THEN
    UPDATE public.booking_payment_requests
    SET status = 'paid_conflict', failure_reason = 'slot_unavailable_after_payment', updated_at = now()
    WHERE id = p_request_id;
    RAISE EXCEPTION 'slot_unavailable_after_payment';
END
$function$;

-- Expiration now covers both old pending appointments and the newer checkout requests.
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
        (NOT EXISTS (SELECT 1 FROM public.payment_intents pi WHERE pi.appointment_id = a.id)
          AND a.created_at < now() - interval '30 minutes')
        OR EXISTS (
          SELECT 1 FROM public.payment_intents pi
          WHERE pi.appointment_id = a.id
            AND pi.status IN ('requires_action','processing')
            AND pi.expires_at IS NOT NULL
            AND pi.expires_at < now()
        )
      )
  )
  UPDATE public.appointments SET status = 'cancelled', cancellation_reason = 'payment_expired', updated_at = now()
  WHERE id IN (SELECT id FROM expired) AND status = 'pending_payment';
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.booking_payment_requests
  SET status = 'expired', failure_reason = COALESCE(failure_reason, 'payment_expired'), updated_at = now()
  WHERE status IN ('awaiting_payment','processing') AND expires_at < now();

  UPDATE public.payment_intents SET status = 'expired', updated_at = now()
  WHERE status IN ('requires_action','processing') AND expires_at IS NOT NULL AND expires_at < now();

  RETURN v_count;
END $$;