BEGIN;

DROP POLICY "Client page members record manual WhatsApp clicks"
ON public.client_manual_whatsapp_confirmations;

DROP POLICY "Client page members read manual WhatsApp confirmations"
ON public.client_manual_whatsapp_confirmations;

COMMIT;
