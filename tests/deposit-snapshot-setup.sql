-- Disposable PostgreSQL only. Minimal synthetic schema for the prepared migration.
CREATE TABLE public.studios (
  id uuid PRIMARY KEY,
  deposit_percent integer NOT NULL,
  studio_policy_settings jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE public.booking_payment_requests (
  id uuid PRIMARY KEY,
  studio_id uuid NOT NULL REFERENCES public.studios(id)
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY,
  studio_id uuid NOT NULL REFERENCES public.studios(id)
);

INSERT INTO public.studios (id, deposit_percent)
VALUES ('10000000-0000-0000-0000-000000000001', 20);
INSERT INTO public.booking_payment_requests (id, studio_id)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
INSERT INTO public.appointments (id, studio_id)
VALUES ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001');
