ALTER TABLE public.studios
  ALTER COLUMN payment_policy SET DEFAULT 'pre_payment',
  ALTER COLUMN deposit_percent SET DEFAULT 25;

REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_paid_booking_request(UUID, TEXT) FROM authenticated;