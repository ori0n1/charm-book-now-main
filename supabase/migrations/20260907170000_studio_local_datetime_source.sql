-- Convert agenda wall-clock selections at the database boundary using the
-- studio timezone. This removes browser/server timezone interpretation from
-- manual creation, preview and rescheduling.

CREATE OR REPLACE FUNCTION public.resolve_studio_local_datetime(
  p_studio_id uuid,
  p_local_date date,
  p_local_time time
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_timezone text;
  v_instant timestamptz;
  v_roundtrip timestamp;
BEGIN
  IF p_studio_id IS NULL OR p_local_date IS NULL OR p_local_time IS NULL THEN
    RAISE EXCEPTION 'invalid_schedule_datetime';
  END IF;
  IF auth.role() <> 'service_role'
     AND NOT public.can_use_studio(auth.uid(), p_studio_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT coalesce(nullif(s.timezone, ''), 'Europe/Lisbon')
    INTO v_timezone
  FROM public.studios s
  WHERE s.id = p_studio_id;
  IF v_timezone IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  v_instant := (p_local_date::timestamp + p_local_time) AT TIME ZONE v_timezone;
  v_roundtrip := v_instant AT TIME ZONE v_timezone;

  -- Reject a non-existent civil time during the spring DST transition. An
  -- ambiguous autumn time remains deterministic under PostgreSQL timezone data.
  IF v_roundtrip::date IS DISTINCT FROM p_local_date
     OR to_char(v_roundtrip, 'HH24:MI') IS DISTINCT FROM to_char(p_local_time, 'HH24:MI') THEN
    RAISE EXCEPTION 'invalid_schedule_datetime_for_timezone';
  END IF;
  RETURN v_instant;
END
$$;

REVOKE ALL ON FUNCTION public.resolve_studio_local_datetime(uuid, date, time)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_studio_local_datetime(uuid, date, time)
  TO service_role;

NOTIFY pgrst, 'reload schema';
