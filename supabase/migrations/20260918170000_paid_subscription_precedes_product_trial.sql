-- Paid access is authoritative when it overlaps a product trial. This avoids
-- showing a paid Pro studio as Premium/trialing because of a stale or reset
-- product-trial date. Stripe data itself is not changed by this migration.
CREATE OR REPLACE FUNCTION public.studio_effective_plan_tier(
  _studio_id uuid,
  _at timestamptz DEFAULT now()
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_studio public.studios%ROWTYPE;
  v_subscription_tier text;
BEGIN
  SELECT * INTO v_studio
  FROM public.studios
  WHERE id = _studio_id;

  IF NOT FOUND OR v_studio.is_active IS DISTINCT FROM true THEN
    RETURN 'free';
  END IF;

  -- A paid or Stripe-managed period wins over the product trial. This keeps
  -- paid Pro/Premium studios unchanged during administrative trial resets.
  SELECT coalesce(sub.plan_tier, 'premium')
  INTO v_subscription_tier
  FROM public.subscriptions sub
  WHERE sub.studio_id = _studio_id
    AND sub.status IN ('active', 'trialing', 'canceled')
    AND sub.current_period_end IS NOT NULL
    AND sub.current_period_end > _at
  ORDER BY sub.updated_at DESC
  LIMIT 1;

  IF v_subscription_tier IN ('pro', 'premium') THEN
    RETURN v_subscription_tier;
  END IF;

  IF v_studio.subscription_status IN ('active', 'trialing', 'canceled')
    AND (
      v_studio.subscription_current_period_end > _at
      OR v_studio.premium_access_until > _at
    ) THEN
    RETURN CASE
      WHEN v_studio.plan_tier IN ('pro', 'premium') THEN v_studio.plan_tier
      ELSE 'premium'
    END;
  END IF;

  -- A Bellza product trial grants the full Premium experience.
  IF v_studio.trial_ends_at IS NOT NULL AND v_studio.trial_ends_at > _at THEN
    RETURN 'premium';
  END IF;

  RETURN 'free';
END
$function$;

REVOKE ALL ON FUNCTION public.studio_effective_plan_tier(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_effective_plan_tier(uuid, timestamptz)
  TO authenticated, service_role;
