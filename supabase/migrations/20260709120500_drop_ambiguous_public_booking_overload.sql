-- PostgREST cannot resolve overloaded RPC functions when the request body can
-- match more than one signature. Keep a single public RPC signature and let the
-- optional referral parameter default to NULL for older callers.

DROP FUNCTION IF EXISTS public.create_public_booking(
  text,
  uuid,
  timestamp with time zone,
  uuid[],
  text,
  text,
  text,
  text
);

GRANT EXECUTE ON FUNCTION public.create_public_booking(
  text,
  uuid,
  timestamp with time zone,
  uuid[],
  text,
  text,
  text,
  text,
  text
) TO anon, authenticated;
