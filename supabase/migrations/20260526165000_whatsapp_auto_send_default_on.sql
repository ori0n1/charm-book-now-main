ALTER TABLE public.studios
  ALTER COLUMN whatsapp_auto_send_enabled SET DEFAULT true;

UPDATE public.studios
SET whatsapp_auto_send_enabled = true,
    updated_at = now()
WHERE id IN (
  SELECT DISTINCT studio_id
  FROM public.whatsapp_message_logs
  WHERE status = 'skipped'
    AND reason = 'auto_send_disabled'
);
