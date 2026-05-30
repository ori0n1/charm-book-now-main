-- Apagar todos os dados aplicacionais e contas de utilizador
TRUNCATE TABLE
  public.appointment_services,
  public.appointments,
  public.booking_payment_requests,
  public.payment_intents,
  public.notifications_log,
  public.onboarding_progress,
  public.upsell_offers,
  public.staff_time_off,
  public.staff_services,
  public.staff_availability,
  public.staff,
  public.services,
  public.service_categories,
  public.clients,
  public.user_roles,
  public.studios,
  public.profiles
RESTART IDENTITY CASCADE;

-- Apagar todos os utilizadores de autenticação
DELETE FROM auth.users;