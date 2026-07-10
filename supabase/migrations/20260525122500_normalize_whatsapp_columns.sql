ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS whatsapp_auto_send_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_default_message TEXT;

UPDATE public.studios
SET whatsapp_default_message = COALESCE(
  whatsapp_default_message,
  'Olá, {nome_cliente}! O seu sinal foi confirmado com sucesso. O seu agendamento para {serviço} está confirmado para o dia {data} às {hora}. Obrigado, {nome_estúdio}.'
)
WHERE whatsapp_default_message IS NULL;

ALTER TABLE public.whatsapp_message_logs
  ALTER COLUMN provider SET DEFAULT 'senddm_whatsapp';

NOTIFY pgrst, 'reload schema';
