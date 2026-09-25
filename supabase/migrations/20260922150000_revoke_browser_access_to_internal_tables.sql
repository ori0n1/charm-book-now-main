-- These tables are server-managed or retained as operational backups. RLS with
-- no policies already denies browser rows, but explicit table revokes prevent a
-- future policy change from silently activating legacy default grants.

REVOKE ALL ON TABLE
  public.platform_billing_events,
  public.referral_credits,
  public.referrals,
  public.server_rate_limits,
  public.studio_trial_extension_backup_20260719_1910,
  public.studios_cancel_flag_backup_20260705_194119,
  public.studios_trial_renewal_backup_20260821,
  public.studios_trial_reset_backup_20260807,
  public.studios_trial_restore_backup_20260705_190426,
  public.subscriptions_trial_renewal_backup_20260821,
  public.subscriptions_trial_reset_backup_20260807
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  public.platform_billing_events,
  public.referral_credits,
  public.referrals,
  public.server_rate_limits,
  public.studio_trial_extension_backup_20260719_1910,
  public.studios_cancel_flag_backup_20260705_194119,
  public.studios_trial_renewal_backup_20260821,
  public.studios_trial_reset_backup_20260807,
  public.studios_trial_restore_backup_20260705_190426,
  public.subscriptions_trial_renewal_backup_20260821,
  public.subscriptions_trial_reset_backup_20260807
TO service_role;
