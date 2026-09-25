create or replace function public.finalize_stale_studio_notification_deliveries(
  p_studio_id uuid default null
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_updated integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden';
  end if;

  update public.studio_notification_deliveries d
  set status = 'skipped',
      lease_until = null,
      last_error = 'subscription_inactive_or_membership_removed',
      updated_at = now()
  where d.status in ('pending', 'retry', 'delivering')
    and (p_studio_id is null or d.studio_id = p_studio_id)
    and not exists (
      select 1
      from public.push_subscriptions ps
      where ps.id = d.subscription_id
        and ps.studio_id = d.studio_id
        and ps.audience in ('studio', 'both')
        and ps.revoked_at is null
        and (ps.expiration_time is null or ps.expiration_time > floor(extract(epoch from now()) * 1000))
        and exists (
          select 1
          from public.user_roles ur
          where ur.user_id = ps.user_id
            and ur.studio_id = d.studio_id
        )
    );
  get diagnostics v_updated = row_count;
  v_count := v_count + v_updated;

  update public.studio_notification_deliveries
  set status = 'failed',
      lease_until = null,
      last_error = coalesce(last_error, 'delivery_lease_expired_after_max_attempts'),
      updated_at = now()
  where status = 'delivering'
    and lease_until < now()
    and attempt_count >= 12
    and (p_studio_id is null or studio_id = p_studio_id);
  get diagnostics v_updated = row_count;

  return v_count + v_updated;
end
$$;

notify pgrst, 'reload schema';
