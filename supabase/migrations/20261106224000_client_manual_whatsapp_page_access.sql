BEGIN;

CREATE POLICY "Client page members read manual WhatsApp confirmations"
ON public.client_manual_whatsapp_confirmations
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND r.user_id = auth.uid()
      AND r.role IN ('saas_owner', 'manager', 'staff')
  )
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_manual_whatsapp_confirmations.client_id
      AND c.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND c.archived_at IS NULL
  )
);

CREATE POLICY "Client page members record manual WhatsApp clicks"
ON public.client_manual_whatsapp_confirmations
FOR INSERT TO authenticated
WITH CHECK (
  confirmed_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND r.user_id = auth.uid()
      AND r.role IN ('saas_owner', 'manager', 'staff')
  )
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_manual_whatsapp_confirmations.client_id
      AND c.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND c.archived_at IS NULL
  )
);

COMMIT;
