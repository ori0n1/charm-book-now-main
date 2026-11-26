-- Preserve the existing studio/client record and its first confirmation.
-- Repeated openings append timestamps in the same row, leaving the guarded
-- client deletion routine and its known references unchanged.
ALTER TABLE public.client_manual_whatsapp_confirmations
  ADD COLUMN last_opened_at timestamptz,
  ADD COLUMN opened_at_history timestamptz[] NOT NULL DEFAULT '{}';

CREATE POLICY "Client page members refresh manual WhatsApp confirmations"
ON public.client_manual_whatsapp_confirmations
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND r.user_id = auth.uid()
      AND r.role IN ('studio_owner', 'saas_owner', 'manager', 'staff')
  )
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_manual_whatsapp_confirmations.client_id
      AND c.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND c.archived_at IS NULL
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND r.user_id = auth.uid()
      AND r.role IN ('studio_owner', 'saas_owner', 'manager', 'staff')
  )
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_manual_whatsapp_confirmations.client_id
      AND c.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND c.archived_at IS NULL
  )
);

-- Supabase's existing table-level UPDATE grant would override a column grant.
-- No UPDATE policy exists before this migration, so revoke that unused grant.
REVOKE UPDATE ON public.client_manual_whatsapp_confirmations FROM authenticated;
GRANT UPDATE (last_opened_at)
ON public.client_manual_whatsapp_confirmations TO authenticated;

CREATE FUNCTION public.append_client_manual_whatsapp_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.last_opened_at := clock_timestamp();
  NEW.opened_at_history := OLD.opened_at_history || NEW.last_opened_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.append_client_manual_whatsapp_open() FROM PUBLIC;

CREATE TRIGGER append_client_manual_whatsapp_open
BEFORE UPDATE OF last_opened_at ON public.client_manual_whatsapp_confirmations
FOR EACH ROW EXECUTE FUNCTION public.append_client_manual_whatsapp_open();

CREATE FUNCTION public.record_client_manual_whatsapp_open(p_studio_id uuid, p_client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.client_manual_whatsapp_confirmations (studio_id, client_id)
  VALUES (p_studio_id, p_client_id)
  ON CONFLICT (studio_id, client_id) DO UPDATE
    SET last_opened_at = clock_timestamp();
END;
$$;

REVOKE ALL ON FUNCTION public.record_client_manual_whatsapp_open(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_client_manual_whatsapp_open(uuid, uuid) TO authenticated;
