CREATE TABLE IF NOT EXISTS public.email_message_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  payment_intent_id UUID REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'resend_email',
  recipient_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  reason TEXT,
  provider_message_id TEXT,
  subject TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_message_logs_studio_created
  ON public.email_message_logs(studio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_message_logs_appointment
  ON public.email_message_logs(appointment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_message_logs_payment
  ON public.email_message_logs(payment_intent_id, created_at DESC)
  WHERE payment_intent_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_email_message_logs_updated ON public.email_message_logs;
CREATE TRIGGER trg_email_message_logs_updated
  BEFORE UPDATE ON public.email_message_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.email_message_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read email message logs" ON public.email_message_logs;
CREATE POLICY "Members read email message logs" ON public.email_message_logs
  FOR SELECT TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id));

DROP POLICY IF EXISTS "Service role manages email message logs" ON public.email_message_logs;
CREATE POLICY "Service role manages email message logs" ON public.email_message_logs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
