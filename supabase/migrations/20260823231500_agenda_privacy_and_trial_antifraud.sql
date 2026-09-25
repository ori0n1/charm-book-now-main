-- Residual HIGH hardening: enforce agenda privacy in the database and ensure
-- trial identity signals can only be supplied by the trusted application server.

CREATE OR REPLACE FUNCTION public.has_privileged_studio_access(_user_id uuid, _studio_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.studio_id = _studio_id
      AND ur.role::text IN ('saas_owner', 'studio_owner', 'manager')
  )
$$;

CREATE OR REPLACE FUNCTION public.staff_owns_appointment(_user_id uuid, _appointment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.appointments a
    JOIN public.staff st
      ON st.id = a.staff_id
     AND st.studio_id = a.studio_id
     AND st.is_active = true
    JOIN public.user_roles ur
      ON ur.user_id = _user_id
     AND ur.studio_id = a.studio_id
     AND ur.role::text = 'staff'
    WHERE a.id = _appointment_id
      AND st.user_id = _user_id
  )
$$;

REVOKE ALL ON FUNCTION public.has_privileged_studio_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_owns_appointment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_privileged_studio_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_owns_appointment(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members manage appointments" ON public.appointments;
DROP POLICY IF EXISTS "Privileged members manage appointments" ON public.appointments;
DROP POLICY IF EXISTS "Professionals manage own appointments" ON public.appointments;

CREATE POLICY "Privileged members manage appointments"
ON public.appointments
FOR ALL
TO authenticated
USING (public.has_privileged_studio_access(auth.uid(), studio_id))
WITH CHECK (public.has_privileged_studio_access(auth.uid(), studio_id));

CREATE POLICY "Professionals manage own appointments"
ON public.appointments
FOR ALL
TO authenticated
USING (public.staff_owns_appointment(auth.uid(), id))
WITH CHECK (
  public.has_privileged_studio_access(auth.uid(), studio_id)
  OR EXISTS (
    SELECT 1
    FROM public.staff st
    JOIN public.user_roles ur
      ON ur.user_id = auth.uid()
     AND ur.studio_id = appointments.studio_id
     AND ur.role::text = 'staff'
    WHERE st.id = appointments.staff_id
      AND st.studio_id = appointments.studio_id
      AND st.user_id = auth.uid()
      AND st.is_active = true
  )
);

DROP POLICY IF EXISTS "Members manage clients" ON public.clients;
DROP POLICY IF EXISTS "Privileged members manage clients" ON public.clients;
DROP POLICY IF EXISTS "Professionals read served clients" ON public.clients;
DROP POLICY IF EXISTS "Professionals update served clients" ON public.clients;

CREATE POLICY "Privileged members manage clients"
ON public.clients
FOR ALL
TO authenticated
USING (public.has_privileged_studio_access(auth.uid(), studio_id))
WITH CHECK (public.has_privileged_studio_access(auth.uid(), studio_id));

CREATE POLICY "Professionals read served clients"
ON public.clients
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.client_id = clients.id
      AND public.staff_owns_appointment(auth.uid(), a.id)
  )
);

CREATE POLICY "Professionals update served clients"
ON public.clients
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.client_id = clients.id
      AND public.staff_owns_appointment(auth.uid(), a.id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.client_id = clients.id
      AND public.staff_owns_appointment(auth.uid(), a.id)
  )
);

DROP POLICY IF EXISTS "Members manage appointment_services" ON public.appointment_services;
DROP POLICY IF EXISTS "Privileged members manage appointment services" ON public.appointment_services;
DROP POLICY IF EXISTS "Professionals manage own appointment services" ON public.appointment_services;

CREATE POLICY "Privileged members manage appointment services"
ON public.appointment_services
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = appointment_services.appointment_id
      AND public.has_privileged_studio_access(auth.uid(), a.studio_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.appointments a
    WHERE a.id = appointment_services.appointment_id
      AND public.has_privileged_studio_access(auth.uid(), a.studio_id)
  )
);

CREATE POLICY "Professionals manage own appointment services"
ON public.appointment_services
FOR ALL
TO authenticated
USING (public.staff_owns_appointment(auth.uid(), appointment_id))
WITH CHECK (public.staff_owns_appointment(auth.uid(), appointment_id));

DROP POLICY IF EXISTS "Members read payment_intents" ON public.payment_intents;
DROP POLICY IF EXISTS "Privileged members read payment intents" ON public.payment_intents;
DROP POLICY IF EXISTS "Professionals read own payment intents" ON public.payment_intents;

CREATE POLICY "Privileged members read payment intents"
ON public.payment_intents
FOR SELECT
TO authenticated
USING (public.has_privileged_studio_access(auth.uid(), studio_id));

CREATE POLICY "Professionals read own payment intents"
ON public.payment_intents
FOR SELECT
TO authenticated
USING (
  appointment_id IS NOT NULL
  AND public.staff_owns_appointment(auth.uid(), appointment_id)
);

DROP POLICY IF EXISTS "Members read whatsapp message logs" ON public.whatsapp_message_logs;
DROP POLICY IF EXISTS "Privileged members read whatsapp logs" ON public.whatsapp_message_logs;
DROP POLICY IF EXISTS "Professionals read own whatsapp logs" ON public.whatsapp_message_logs;

CREATE POLICY "Privileged members read whatsapp logs"
ON public.whatsapp_message_logs
FOR SELECT
TO authenticated
USING (public.has_privileged_studio_access(auth.uid(), studio_id));

CREATE POLICY "Professionals read own whatsapp logs"
ON public.whatsapp_message_logs
FOR SELECT
TO authenticated
USING (
  appointment_id IS NOT NULL
  AND public.staff_owns_appointment(auth.uid(), appointment_id)
);

-- New server-only overload. The owner id comes from a verified access token in
-- the application server; the browser cannot invent IP/device hashes anymore.
CREATE OR REPLACE FUNCTION public.create_studio_with_owner(
  p_owner_user_id uuid,
  p_name text,
  p_slug text,
  p_timezone text DEFAULT 'Europe/Lisbon',
  p_currency text DEFAULT 'EUR',
  p_business_segment text DEFAULT 'beauty',
  p_trial_phone text DEFAULT NULL,
  p_trial_device_fingerprint_hash text DEFAULT NULL,
  p_trial_ip_hash text DEFAULT NULL,
  p_trial_nif text DEFAULT NULL,
  p_trial_stripe_account_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_studio_id uuid;
  v_phone text := public.normalize_trial_phone(p_trial_phone);
  v_slug text := public.normalize_trial_text(p_slug);
  v_name text := public.normalize_trial_text(p_name);
  v_nif text := public.normalize_trial_phone(p_trial_nif);
  v_device_hash text := nullif(trim(coalesce(p_trial_device_fingerprint_hash, '')), '');
  v_ip_hash text := nullif(trim(coalesce(p_trial_ip_hash, '')), '');
  v_stripe_account text := nullif(trim(coalesce(p_trial_stripe_account_id, '')), '');
BEGIN
  IF p_owner_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p_owner_user_id
  ) THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_business_segment NOT IN ('beauty', 'barbershop', 'nail_studio', 'clinic', 'other') THEN
    RAISE EXCEPTION 'invalid_business_segment';
  END IF;

  INSERT INTO public.studios (
    name, slug, timezone, currency, business_segment, phone,
    subscription_status, trial_ends_at, trial_claimed_at,
    trial_identity_phone, trial_identity_studio_name, trial_identity_slug,
    trial_identity_ip_hash, trial_identity_device_fingerprint_hash,
    trial_identity_nif, trial_identity_stripe_account_id
  ) VALUES (
    p_name, p_slug, p_timezone, p_currency, p_business_segment, v_phone,
    'trialing', now() + interval '14 days', now(),
    v_phone, v_name, v_slug, v_ip_hash, v_device_hash, v_nif, v_stripe_account
  )
  RETURNING id INTO v_studio_id;

  INSERT INTO public.user_roles (user_id, studio_id, role)
  VALUES (p_owner_user_id, v_studio_id, 'studio_owner');

  RETURN v_studio_id;
END
$$;

REVOKE ALL ON FUNCTION public.create_studio_with_owner(
  text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_studio_with_owner(
  uuid, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_studio_with_owner(
  uuid, text, text, text, text, text, text, text, text, text, text
) TO service_role;
