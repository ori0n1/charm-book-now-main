-- Single, server-only overview for Central Bellza > WhatsApp.
-- It replaces the previous N+1 PostgREST aggregation while keeping RLS on all
-- underlying tables. The RPC is executable only by service_role; the Worker
-- validates the authenticated SaaS owner before invoking it.

CREATE OR REPLACE FUNCTION public.get_whatsapp_admin_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'whatsapp_admin_overview_forbidden' USING ERRCODE = '42501';
  END IF;

  WITH settings AS (
    SELECT * FROM public.whatsapp_platform_settings WHERE id = 1
  ),
  studio_rollup AS (
    SELECT
      s.id,
      s.name,
      s.subscription_status,
      s.whatsapp_auto_send_enabled,
      coalesce(e.status, 'inactive') AS whatsapp_status,
      e.trial_started_at,
      coalesce(e.trial_ends_at, s.trial_ends_at) AS whatsapp_trial_ends_at,
      e.addon_started_at,
      e.addon_ends_at,
      e.paused_reason,
      CASE
        WHEN e.status = 'trial' THEN coalesce(e.trial_message_limit_override, cfg.trial_message_limit)
        ELSE NULL
      END AS message_limit,
      coalesce(u.used, 0)::integer AS used,
      coalesce(u.reserved, 0)::integer AS reserved,
      coalesce(l.sent, 0)::integer AS sent_messages,
      coalesce(l.pending, 0)::integer AS pending_messages,
      coalesce(l.failed, 0)::integer AS failed_messages,
      coalesce(l.blocked, 0)::integer AS blocked_messages,
      coalesce(u.provider_cost_cents, 0)::bigint AS estimated_provider_cost_cents,
      coalesce(u.revenue_cents, 0)::bigint AS estimated_revenue_cents,
      greatest(u.last_activity_at, l.last_activity_at) AS last_activity_at,
      CASE
        WHEN NOT cfg.global_enabled THEN false
        WHEN e.status = 'legacy' THEN true
        WHEN e.status = 'active' THEN e.addon_ends_at IS NULL OR e.addon_ends_at > now()
        WHEN e.status = 'trial' THEN
          cfg.trial_enabled
          AND coalesce(e.trial_ends_at, s.trial_ends_at) > now()
          AND coalesce(u.used, 0) + coalesce(u.reserved, 0)
              < coalesce(e.trial_message_limit_override, cfg.trial_message_limit)
        ELSE false
      END AS available
    FROM public.studios s
    CROSS JOIN settings cfg
    LEFT JOIN public.whatsapp_studio_entitlements e ON e.studio_id = s.id
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE w.state IN ('submitted', 'counted')) AS used,
        count(*) FILTER (WHERE w.state = 'reserved') AS reserved,
        sum(w.unit_cost_cents) FILTER (WHERE w.state IN ('submitted', 'counted')) AS provider_cost_cents,
        sum(w.commercial_unit_cents) FILTER (WHERE w.state IN ('submitted', 'counted')) AS revenue_cents,
        max(w.updated_at) AS last_activity_at
      FROM public.whatsapp_usage_ledger w
      WHERE w.studio_id = s.id
        AND (
          e.status IS DISTINCT FROM 'trial'
          OR (
            w.created_at >= coalesce(e.trial_started_at, '-infinity'::timestamptz)
            AND w.created_at < coalesce(e.trial_ends_at, s.trial_ends_at, 'infinity'::timestamptz)
          )
        )
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*) FILTER (WHERE m.status = 'sent') AS sent,
        count(*) FILTER (WHERE m.status = 'pending') AS pending,
        count(*) FILTER (WHERE m.status = 'failed') AS failed,
        count(*) FILTER (
          WHERE m.status = 'skipped' AND coalesce(m.reason, '') LIKE 'whatsapp_%'
        ) AS blocked,
        max(m.updated_at) AS last_activity_at
      FROM public.whatsapp_message_logs m
      WHERE m.studio_id = s.id
    ) l ON true
  ),
  global_usage AS (
    SELECT
      count(*) FILTER (WHERE state IN ('submitted', 'counted'))::integer AS messages,
      coalesce(sum(unit_cost_cents) FILTER (WHERE state IN ('submitted', 'counted')), 0)::bigint AS provider_cost_cents,
      coalesce(sum(commercial_unit_cents) FILTER (WHERE state IN ('submitted', 'counted')), 0)::bigint AS revenue_cents
    FROM public.whatsapp_usage_ledger
  ),
  global_logs AS (
    SELECT
      count(*) FILTER (WHERE status = 'failed')::integer AS failed,
      count(*) FILTER (
        WHERE status = 'skipped' AND coalesce(reason, '') LIKE 'whatsapp_%'
      )::integer AS blocked
    FROM public.whatsapp_message_logs
  )
  SELECT jsonb_build_object(
    'settings', jsonb_build_object(
      'id', cfg.id,
      'global_enabled', cfg.global_enabled,
      'trial_enabled', cfg.trial_enabled,
      'trial_duration_days', cfg.trial_duration_days,
      'trial_message_limit', cfg.trial_message_limit,
      'alert_thresholds', cfg.alert_thresholds,
      'post_trial_mode', cfg.post_trial_mode,
      'billing_mode', cfg.billing_mode,
      'provider_cost_per_message_cents', cfg.provider_cost_per_message_cents,
      'commercial_price_cents', cfg.commercial_price_cents,
      'commercial_included_messages', cfg.commercial_included_messages,
      'commercial_excess_message_cents', cfg.commercial_excess_message_cents,
      'currency', cfg.currency,
      'provider_contract_verified_at', cfg.provider_contract_verified_at,
      'updated_at', cfg.updated_at
    ),
    'summary', jsonb_build_object(
      'studiosUsing', count(*) FILTER (WHERE r.available AND r.whatsapp_auto_send_enabled),
      'trialStudios', count(*) FILTER (WHERE r.whatsapp_status = 'trial'),
      'payingStudios', count(*) FILTER (WHERE r.whatsapp_status = 'active'),
      'messages', gu.messages,
      'failedMessages', gl.failed,
      'blockedMessages', gl.blocked,
      'estimatedProviderCostCents', gu.provider_cost_cents,
      'estimatedRevenueCents', gu.revenue_cents,
      'costConfigured', cfg.provider_cost_per_message_cents IS NOT NULL
    ),
    'studios', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'name', r.name,
          'subscriptionStatus', r.subscription_status,
          'status', r.whatsapp_status,
          'available', r.available,
          'autoSendEnabled', r.whatsapp_auto_send_enabled,
          'trialEndsAt', r.whatsapp_trial_ends_at,
          'daysRemaining', CASE
            WHEN r.whatsapp_status = 'trial' AND r.whatsapp_trial_ends_at IS NOT NULL
            THEN greatest(0, ceil(extract(epoch FROM (r.whatsapp_trial_ends_at - now())) / 86400.0))::integer
            ELSE NULL
          END,
          'used', r.used,
          'reserved', r.reserved,
          'limit', r.message_limit,
          'remaining', CASE
            WHEN r.message_limit IS NULL THEN NULL
            ELSE greatest(0, r.message_limit - r.used - r.reserved)
          END,
          'usagePercent', CASE
            WHEN r.message_limit IS NULL THEN NULL
            WHEN r.message_limit = 0 THEN 100
            ELSE least(100, round(((r.used + r.reserved)::numeric / r.message_limit) * 100))::integer
          END,
          'pauseReason', r.paused_reason,
          'billingAvailable', cfg.billing_mode <> 'disabled' AND cfg.commercial_price_cents IS NOT NULL,
          'billingMode', cfg.billing_mode,
          'commercialPriceCents', cfg.commercial_price_cents,
          'currency', cfg.currency,
          'sentMessages', r.sent_messages,
          'pendingMessages', r.pending_messages,
          'failedMessages', r.failed_messages,
          'blockedMessages', r.blocked_messages,
          'estimatedProviderCostCents', r.estimated_provider_cost_cents,
          'estimatedRevenueCents', r.estimated_revenue_cents,
          'lastActivityAt', r.last_activity_at
        ) ORDER BY r.name
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM settings cfg
  CROSS JOIN global_usage gu
  CROSS JOIN global_logs gl
  LEFT JOIN studio_rollup r ON true
  GROUP BY cfg.id, cfg.global_enabled, cfg.trial_enabled, cfg.trial_duration_days,
           cfg.trial_message_limit, cfg.alert_thresholds, cfg.post_trial_mode,
           cfg.billing_mode, cfg.provider_cost_per_message_cents,
           cfg.commercial_price_cents, cfg.commercial_included_messages,
           cfg.commercial_excess_message_cents, cfg.currency,
           cfg.provider_contract_verified_at, cfg.updated_by,
           cfg.created_at, cfg.updated_at,
           gu.messages, gu.provider_cost_cents, gu.revenue_cents,
           gl.failed, gl.blocked;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'whatsapp_platform_settings_missing' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION public.get_whatsapp_admin_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_admin_overview() TO service_role;

COMMENT ON FUNCTION public.get_whatsapp_admin_overview() IS
  'Server-only aggregate for Central Bellza WhatsApp. The Worker must authorize SaaS owner first.';

NOTIFY pgrst, 'reload schema';
