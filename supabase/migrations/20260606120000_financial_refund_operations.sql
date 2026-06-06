ALTER TABLE public.refund_requests
  ADD COLUMN IF NOT EXISTS platform_processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS platform_processed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_refund_id text,
  ADD COLUMN IF NOT EXISTS refund_method text,
  ADD COLUMN IF NOT EXISTS admin_notes text;

CREATE INDEX IF NOT EXISTS idx_refund_requests_platform_status
  ON public.refund_requests(status, platform_processed_at DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.financial_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id uuid REFERENCES public.studios(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  amount_cents integer,
  currency text NOT NULL DEFAULT 'eur',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_audit_logs_studio_created
  ON public.financial_audit_logs(studio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_audit_logs_entity
  ON public.financial_audit_logs(entity_type, entity_id, created_at DESC);

ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Saas owners read financial audit logs" ON public.financial_audit_logs;
CREATE POLICY "Saas owners read financial audit logs"
ON public.financial_audit_logs
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'saas_owner'
  )
);
