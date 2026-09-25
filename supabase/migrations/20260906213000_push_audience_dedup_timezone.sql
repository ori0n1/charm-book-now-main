-- Remove abandoned team-device endpoints and cap native studio pushes per user.
WITH ranked AS (
  SELECT
    ps.id,
    ps.last_seen_at,
    row_number() OVER (
      PARTITION BY ps.studio_id, ps.user_id
      ORDER BY ps.last_seen_at DESC NULLS LAST, ps.updated_at DESC, ps.id DESC
    ) AS device_rank
  FROM public.push_subscriptions ps
  WHERE ps.revoked_at IS NULL
    AND ps.audience IN ('studio', 'both')
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = ps.user_id AND ur.studio_id = ps.studio_id
    )
)
UPDATE public.push_subscriptions ps
SET revoked_at = now(),
    revocation_reason = CASE
      WHEN ranked.last_seen_at IS NULL OR ranked.last_seen_at < now() - interval '30 days'
        THEN 'device_inactive_30_days'
      ELSE 'device_limit_exceeded'
    END,
    updated_at = now()
FROM ranked
WHERE ps.id = ranked.id
  AND (
    ranked.device_rank > 3
    OR ranked.last_seen_at IS NULL
    OR ranked.last_seen_at < now() - interval '30 days'
  );

CREATE OR REPLACE FUNCTION public.enforce_studio_notification_delivery_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_last_seen_at timestamptz;
  v_updated_at timestamptz;
BEGIN
  SELECT ps.user_id, ps.last_seen_at, ps.updated_at
    INTO v_user_id, v_last_seen_at, v_updated_at
  FROM public.studio_notifications n
  JOIN public.push_subscriptions ps
    ON ps.id = NEW.subscription_id
   AND ps.studio_id = NEW.studio_id
   AND ps.audience IN ('studio', 'both')
   AND ps.revoked_at IS NULL
  JOIN public.user_roles ur
    ON ur.user_id = ps.user_id
   AND ur.studio_id = NEW.studio_id
  WHERE n.id = NEW.notification_id
    AND n.studio_id = NEW.studio_id;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'notification_delivery_studio_mismatch';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_last_seen_at IS NULL OR v_last_seen_at < now() - interval '30 days' THEN
      RETURN NULL;
    END IF;
    IF (
      SELECT count(*)
      FROM public.push_subscriptions newer
      WHERE newer.user_id = v_user_id
        AND newer.studio_id = NEW.studio_id
        AND newer.audience IN ('studio', 'both')
        AND newer.revoked_at IS NULL
        AND newer.last_seen_at >= now() - interval '30 days'
        AND (
          newer.last_seen_at > v_last_seen_at
          OR (newer.last_seen_at = v_last_seen_at AND newer.updated_at > v_updated_at)
        )
    ) >= 3 THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_studio_notification_delivery_tenant()
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
