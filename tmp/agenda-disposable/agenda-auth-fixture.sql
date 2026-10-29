CREATE TABLE public.studios (id uuid PRIMARY KEY, is_active boolean NOT NULL);
CREATE TABLE public.user_roles (user_id uuid NOT NULL, studio_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE public.staff (id uuid PRIMARY KEY, studio_id uuid NOT NULL, user_id uuid, is_active boolean NOT NULL);
CREATE TABLE public.appointments (id uuid PRIMARY KEY, studio_id uuid NOT NULL);

CREATE FUNCTION public.can_use_studio(_user_id uuid, _studio_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND studio_id = _studio_id
      AND role IN ('saas_owner', 'studio_owner', 'manager', 'staff')
  )
$$;

INSERT INTO public.studios VALUES
  ('11111111-1111-4111-8111-111111111111', true),
  ('99999999-9999-4999-8999-999999999999', true);
INSERT INTO public.user_roles VALUES
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-111111111111', 'studio_owner'),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-111111111111', 'manager'),
  ('22222222-2222-4222-8222-000000000003', '11111111-1111-4111-8111-111111111111', 'staff'),
  ('22222222-2222-4222-8222-000000000004', '11111111-1111-4111-8111-111111111111', 'desk_staff'),
  ('22222222-2222-4222-8222-000000000009', '99999999-9999-4999-8999-999999999999', 'studio_owner');
INSERT INTO public.staff VALUES
  ('33333333-3333-4333-8333-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000003', true),
  ('33333333-3333-4333-8333-000000000002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000004', true);
INSERT INTO public.appointments VALUES
  ('44444444-4444-4444-8444-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('44444444-4444-4444-8444-000000000002', '99999999-9999-4999-8999-999999999999');

GRANT SELECT ON public.studios, public.user_roles, public.staff, public.appointments TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_use_studio(uuid,uuid) TO authenticated, service_role;
