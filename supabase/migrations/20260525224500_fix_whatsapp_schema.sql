ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS whatsapp_auto_send_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_default_message TEXT;

UPDATE public.studios
SET whatsapp_default_message = COALESCE(
  whatsapp_default_message,
  'Olá, {nome_cliente}! O seu sinal foi confirmado com sucesso. O seu agendamento para {serviço} está confirmado para o dia {data} às {hora}. Obrigado, {nome_estúdio}.'
)
WHERE whatsapp_default_message IS NULL;

CREATE TABLE IF NOT EXISTS public.whatsapp_message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  payment_intent_id UUID REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'senddm_whatsapp',
  recipient_phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  reason TEXT,
  provider_message_id TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_message_logs
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'senddm_whatsapp',
  ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS message TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.whatsapp_message_logs
  ALTER COLUMN provider SET DEFAULT 'senddm_whatsapp';

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_logs_studio_created
  ON public.whatsapp_message_logs(studio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_logs_appointment
  ON public.whatsapp_message_logs(appointment_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_message_logs_payment_sent_once
  ON public.whatsapp_message_logs(payment_intent_id)
  WHERE payment_intent_id IS NOT NULL AND status = 'sent';

DROP TRIGGER IF EXISTS trg_whatsapp_message_logs_updated ON public.whatsapp_message_logs;
CREATE TRIGGER trg_whatsapp_message_logs_updated
  BEFORE UPDATE ON public.whatsapp_message_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_message_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read whatsapp message logs" ON public.whatsapp_message_logs;
CREATE POLICY "Members read whatsapp message logs" ON public.whatsapp_message_logs
  FOR SELECT TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Service role manages whatsapp message logs" ON public.whatsapp_message_logs;
CREATE POLICY "Service role manages whatsapp message logs" ON public.whatsapp_message_logs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
