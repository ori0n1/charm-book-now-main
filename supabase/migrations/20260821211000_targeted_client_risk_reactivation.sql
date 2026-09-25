-- One client can receive a reactivation campaign only once per risk episode.
-- A new completed visit creates a new risk_started_at and therefore a new episode key.
create unique index if not exists notifications_log_client_risk_episode_unique
  on public.notifications_log (
    studio_id,
    channel,
    kind,
    recipient,
    ((payload ->> 'risk_episode_key'))
  )
  where channel = 'client_center'
    and kind = 'follower_client_at_risk'
    and payload ? 'risk_episode_key';

notify pgrst, 'reload schema';
