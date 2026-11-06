CREATE TABLE public.client_manual_whatsapp_confirmations (
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  confirmed_by uuid NOT NULL DEFAULT auth.uid(),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio_id, client_id)
);

ALTER TABLE public.client_manual_whatsapp_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Studio owner reads manual WhatsApp confirmations"
ON public.client_manual_whatsapp_confirmations
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND r.user_id = auth.uid()
      AND r.role = 'studio_owner'
  )
);

CREATE POLICY "Studio owner confirms manual WhatsApp messages"
ON public.client_manual_whatsapp_confirmations
FOR INSERT TO authenticated
WITH CHECK (
  confirmed_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.user_roles r
    WHERE r.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND r.user_id = auth.uid()
      AND r.role = 'studio_owner'
  )
  AND EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_manual_whatsapp_confirmations.client_id
      AND c.studio_id = client_manual_whatsapp_confirmations.studio_id
      AND c.archived_at IS NULL
  )
);

GRANT SELECT, INSERT ON public.client_manual_whatsapp_confirmations TO authenticated;
