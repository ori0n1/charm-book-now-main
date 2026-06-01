CREATE TABLE IF NOT EXISTS public.server_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.server_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_count integer;
  v_reset_at timestamptz;
BEGIN
  INSERT INTO public.server_rate_limits AS buckets (key, count, reset_at, updated_at)
  VALUES (p_key, 1, v_now + make_interval(secs => p_window_seconds), v_now)
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
          WHEN buckets.reset_at <= v_now THEN 1
          ELSE buckets.count + 1
        END,
        reset_at = CASE
          WHEN buckets.reset_at <= v_now THEN v_now + make_interval(secs => p_window_seconds)
          ELSE buckets.reset_at
        END,
        updated_at = v_now
  RETURNING buckets.count, buckets.reset_at
  INTO v_count, v_reset_at;

  RETURN QUERY SELECT
    v_count <= p_limit,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_reset_at - v_now)))::integer);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(text, integer, integer) TO service_role;
