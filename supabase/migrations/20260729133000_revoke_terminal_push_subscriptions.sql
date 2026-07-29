-- Keep terminal Web Push endpoints out of future delivery fan-out even if an
-- application instance cannot complete its best-effort subscription cleanup.

create or replace function public.revoke_terminal_studio_push_subscription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'failed'
     and new.subscription_id is not null
     and new.last_error in (
       'web_push_400',
       'web_push_401',
       'web_push_403',
       'web_push_404',
       'web_push_410'
     ) then
    update public.push_subscriptions
    set revoked_at = coalesce(revoked_at, now()),
        updated_at = now()
    where id = new.subscription_id
      and revoked_at is null;
  end if;

  return new;
end
$$;

drop trigger if exists trg_revoke_terminal_studio_push_subscription
  on public.studio_notification_deliveries;
create trigger trg_revoke_terminal_studio_push_subscription
  after insert or update of status, last_error
  on public.studio_notification_deliveries
  for each row execute function public.revoke_terminal_studio_push_subscription();

update public.push_subscriptions ps
set revoked_at = coalesce(ps.revoked_at, now()),
    updated_at = now()
where ps.revoked_at is null
  and exists (
    select 1
    from public.studio_notification_deliveries d
    where d.subscription_id = ps.id
      and d.status = 'failed'
      and d.last_error in (
        'web_push_400',
        'web_push_401',
        'web_push_403',
        'web_push_404',
        'web_push_410'
      )
  );

revoke execute on function public.revoke_terminal_studio_push_subscription()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
