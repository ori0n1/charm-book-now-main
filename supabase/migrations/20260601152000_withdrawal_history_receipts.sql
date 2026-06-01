ALTER TABLE public.withdrawal_requests
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS failure_reason text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS status_updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_status_check;

UPDATE public.withdrawal_requests
SET status = 'completed'
WHERE status = 'paid';

UPDATE public.withdrawal_requests
SET status = 'canceled'
WHERE status = 'rejected';

UPDATE public.withdrawal_requests
SET status = 'in_review'
WHERE status = 'pending';

ALTER TABLE public.withdrawal_requests
  ADD CONSTRAINT withdrawal_requests_status_check
    CHECK (status IN ('in_review','processing','completed','failed','canceled','pending','paid','rejected'));

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status_updated
  ON public.withdrawal_requests(studio_id, status_updated_at DESC);
