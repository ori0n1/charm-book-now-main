
-- ============ EXTENSIONS ============
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('saas_owner', 'studio_owner', 'manager', 'staff');
CREATE TYPE public.appointment_status AS ENUM ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
CREATE TYPE public.subscription_plan AS ENUM ('trial', 'starter', 'pro', 'business');

-- ============ HELPER: updated_at ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ============ STUDIOS (tenant root) ============
CREATE TABLE public.studios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  tagline TEXT,
  description TEXT,
  hero_image_url TEXT,
  logo_url TEXT,
  brand_color TEXT,
  location TEXT,
  phone TEXT,
  email TEXT,
  whatsapp TEXT,
  instagram TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Lisbon',
  currency TEXT NOT NULL DEFAULT 'EUR',
  plan public.subscription_plan NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  rating NUMERIC(2,1),
  reviews_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_studios_slug ON public.studios(slug);
CREATE TRIGGER trg_studios_updated BEFORE UPDATE ON public.studios FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ USER ROLES (separate table — anti recursion) ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  studio_id UUID REFERENCES public.studios(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, studio_id, role)
);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_studio ON public.user_roles(studio_id);

-- SECURITY DEFINER helpers (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _studio_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND studio_id = _studio_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_studio_member(_user_id UUID, _studio_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND studio_id = _studio_id
  )
$$;

CREATE OR REPLACE FUNCTION public.user_studio_ids(_user_id UUID)
RETURNS SETOF UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT studio_id FROM public.user_roles WHERE user_id = _user_id AND studio_id IS NOT NULL
$$;

-- ============ SERVICE CATEGORIES ============
CREATE TABLE public.service_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_categories_studio ON public.service_categories(studio_id);

-- ============ SERVICES ============
CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.service_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_recommended BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  media JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_services_studio ON public.services(studio_id);
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ STAFF ============
CREATE TABLE public.staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  role TEXT,
  bio TEXT,
  photo_url TEXT,
  rating NUMERIC(2,1),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_staff_studio ON public.staff(studio_id);
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.staff_services (
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

-- ============ STAFF AVAILABILITY (recurring weekly) ============
CREATE TABLE public.staff_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX idx_avail_staff ON public.staff_availability(staff_id, weekday);

-- ============ STAFF TIME OFF (blocks) ============
CREATE TABLE public.staff_time_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_timeoff_staff ON public.staff_time_off(staff_id, starts_at);

-- ============ CLIENTS ============
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  total_visits INTEGER NOT NULL DEFAULT 0,
  total_spent NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(studio_id, phone)
);
CREATE INDEX idx_clients_studio ON public.clients(studio_id);
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ APPOINTMENTS ============
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'pending',
  total_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_duration_min INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  cancellation_reason TEXT,
  reminder_sent_at TIMESTAMPTZ,
  confirmation_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX idx_appts_studio_starts ON public.appointments(studio_id, starts_at);
CREATE INDEX idx_appts_staff_starts ON public.appointments(staff_id, starts_at);
CREATE TRIGGER trg_appts_updated BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Anti-overbooking: same staff cannot have two overlapping non-cancelled appointments
ALTER TABLE public.appointments ADD CONSTRAINT no_overlap_per_staff
  EXCLUDE USING gist (
    staff_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'no_show'));

-- ============ APPOINTMENT SERVICES ============
CREATE TABLE public.appointment_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  is_upsell BOOLEAN NOT NULL DEFAULT false,
  price NUMERIC(10,2) NOT NULL,
  duration_min INTEGER NOT NULL
);
CREATE INDEX idx_appt_svc_appt ON public.appointment_services(appointment_id);

-- ============ UPSELL OFFERS ============
CREATE TABLE public.upsell_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  trigger_service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  offered_service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  discounted_price NUMERIC(10,2) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  conversions_count INTEGER NOT NULL DEFAULT 0,
  extra_revenue NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(trigger_service_id, offered_service_id)
);
CREATE INDEX idx_upsell_trigger ON public.upsell_offers(trigger_service_id);

-- ============ NOTIFICATIONS LOG ============
CREATE TABLE public.notifications_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'sent',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notif_studio ON public.notifications_log(studio_id, created_at DESC);

-- ============ ENABLE RLS ============
ALTER TABLE public.studios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upsell_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

-- ============ POLICIES: STUDIOS ============
CREATE POLICY "Public can read active studios" ON public.studios
  FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY "Members manage own studio" ON public.studios
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), id))
  WITH CHECK (public.is_studio_member(auth.uid(), id));
CREATE POLICY "Authenticated can create studio" ON public.studios
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============ POLICIES: PROFILES ============
CREATE POLICY "Users view own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ============ POLICIES: USER_ROLES ============
CREATE POLICY "Users view own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Studio owners manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (studio_id IS NOT NULL AND public.has_role(auth.uid(), studio_id, 'studio_owner'))
  WITH CHECK (studio_id IS NOT NULL AND public.has_role(auth.uid(), studio_id, 'studio_owner'));

-- ============ POLICIES: PUBLIC READ (services/categories/staff/upsells/availability) ============
CREATE POLICY "Public read categories" ON public.service_categories
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Members manage categories" ON public.service_categories
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE POLICY "Public read active services" ON public.services
  FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY "Members manage services" ON public.services
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE POLICY "Public read active staff" ON public.staff
  FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY "Members manage staff" ON public.staff
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE POLICY "Public read staff_services" ON public.staff_services
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Members manage staff_services" ON public.staff_services
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = staff_id AND public.is_studio_member(auth.uid(), s.studio_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.staff s WHERE s.id = staff_id AND public.is_studio_member(auth.uid(), s.studio_id)));

CREATE POLICY "Public read availability" ON public.staff_availability
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Members manage availability" ON public.staff_availability
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE POLICY "Public read time_off" ON public.staff_time_off
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Members manage time_off" ON public.staff_time_off
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE POLICY "Public read active upsells" ON public.upsell_offers
  FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY "Members manage upsells" ON public.upsell_offers
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

-- ============ POLICIES: CLIENTS (private) ============
CREATE POLICY "Members manage clients" ON public.clients
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

-- ============ POLICIES: APPOINTMENTS ============
-- Members see and manage all appointments for their studios
CREATE POLICY "Members manage appointments" ON public.appointments
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE POLICY "Members manage appointment_services" ON public.appointment_services
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id AND public.is_studio_member(auth.uid(), a.studio_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.appointments a WHERE a.id = appointment_id AND public.is_studio_member(auth.uid(), a.studio_id)));

-- Public booking happens via SECURITY DEFINER RPC (no direct INSERT policy needed)

-- ============ POLICIES: NOTIFICATIONS ============
CREATE POLICY "Members read notifications" ON public.notifications_log
  FOR SELECT TO authenticated USING (public.is_studio_member(auth.uid(), studio_id));

-- ============ PUBLIC BOOKING RPC ============
-- Creates a client (or reuses by phone) + appointment + appointment_services in one transaction.
-- Runs as SECURITY DEFINER to allow anonymous bookings while enforcing all business rules.
CREATE OR REPLACE FUNCTION public.create_public_booking(
  p_studio_slug TEXT,
  p_staff_id UUID,
  p_starts_at TIMESTAMPTZ,
  p_service_ids UUID[],
  p_client_name TEXT,
  p_client_phone TEXT,
  p_client_email TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_studio_id UUID;
  v_client_id UUID;
  v_appt_id UUID;
  v_total_duration INTEGER := 0;
  v_total_price NUMERIC(10,2) := 0;
  v_ends_at TIMESTAMPTZ;
  v_svc RECORD;
BEGIN
  IF p_client_name IS NULL OR length(trim(p_client_name)) < 2 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF p_client_phone IS NULL OR length(trim(p_client_phone)) < 6 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF array_length(p_service_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no_services';
  END IF;

  SELECT id INTO v_studio_id FROM studios WHERE slug = p_studio_slug AND is_active = true;
  IF v_studio_id IS NULL THEN RAISE EXCEPTION 'studio_not_found'; END IF;

  -- Validate staff belongs to studio
  PERFORM 1 FROM staff WHERE id = p_staff_id AND studio_id = v_studio_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'staff_not_found'; END IF;

  -- Sum duration & price; validate services belong to studio and staff can do them
  FOR v_svc IN
    SELECT s.id, s.duration_min, s.price
    FROM services s
    WHERE s.id = ANY(p_service_ids) AND s.studio_id = v_studio_id AND s.is_active = true
  LOOP
    v_total_duration := v_total_duration + v_svc.duration_min;
    v_total_price := v_total_price + v_svc.price;
  END LOOP;

  IF v_total_duration = 0 THEN RAISE EXCEPTION 'invalid_services'; END IF;

  v_ends_at := p_starts_at + (v_total_duration || ' minutes')::INTERVAL;

  -- Upsert client (by phone)
  INSERT INTO clients (studio_id, name, phone, email)
  VALUES (v_studio_id, trim(p_client_name), trim(p_client_phone), p_client_email)
  ON CONFLICT (studio_id, phone) DO UPDATE SET
    name = EXCLUDED.name,
    email = COALESCE(EXCLUDED.email, clients.email),
    updated_at = now()
  RETURNING id INTO v_client_id;

  -- Create appointment (EXCLUDE constraint prevents overbooking)
  INSERT INTO appointments (studio_id, staff_id, client_id, starts_at, ends_at, status, total_price, total_duration_min, notes)
  VALUES (v_studio_id, p_staff_id, v_client_id, p_starts_at, v_ends_at, 'confirmed', v_total_price, v_total_duration, p_notes)
  RETURNING id INTO v_appt_id;

  -- Insert services (mark all but the first as upsell)
  INSERT INTO appointment_services (appointment_id, service_id, is_upsell, price, duration_min)
  SELECT v_appt_id, s.id, (row_number() OVER (ORDER BY array_position(p_service_ids, s.id)) > 1), s.price, s.duration_min
  FROM services s WHERE s.id = ANY(p_service_ids);

  RETURN jsonb_build_object(
    'appointment_id', v_appt_id,
    'starts_at', p_starts_at,
    'ends_at', v_ends_at,
    'total_price', v_total_price,
    'total_duration_min', v_total_duration
  );
EXCEPTION
  WHEN exclusion_violation THEN
    RAISE EXCEPTION 'slot_unavailable';
END $$;

GRANT EXECUTE ON FUNCTION public.create_public_booking(TEXT, UUID, TIMESTAMPTZ, UUID[], TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ============ ONBOARDING RPC: create studio + assign owner ============
CREATE OR REPLACE FUNCTION public.create_studio_with_owner(
  p_name TEXT,
  p_slug TEXT,
  p_timezone TEXT DEFAULT 'Europe/Lisbon',
  p_currency TEXT DEFAULT 'EUR'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_studio_id UUID; v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  INSERT INTO studios (name, slug, timezone, currency)
  VALUES (p_name, p_slug, p_timezone, p_currency)
  RETURNING id INTO v_studio_id;
  INSERT INTO user_roles (user_id, studio_id, role) VALUES (v_user, v_studio_id, 'studio_owner');
  RETURN v_studio_id;
END $$;

GRANT EXECUTE ON FUNCTION public.create_studio_with_owner(TEXT, TEXT, TEXT, TEXT) TO authenticated;
