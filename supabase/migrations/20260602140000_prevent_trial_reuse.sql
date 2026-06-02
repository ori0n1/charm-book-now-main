-- Add trial_used_at to studios to prevent trial reuse exploit
-- Timestamp is set when trial is first redeemed in checkout session

ALTER TABLE public.studios
ADD COLUMN trial_used_at TIMESTAMPTZ;

COMMENT ON COLUMN public.studios.trial_used_at IS 'When trial was first claimed. Prevents infinite trial reuse exploit.';

-- Create index for querying studios with claimed trials
CREATE INDEX idx_studios_trial_used_at ON public.studios(trial_used_at);
