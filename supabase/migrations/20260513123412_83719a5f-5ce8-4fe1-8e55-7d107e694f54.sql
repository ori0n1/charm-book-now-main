
ALTER TABLE public.studios ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(studio_id, step)
);
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage onboarding_progress" ON public.onboarding_progress
  FOR ALL TO authenticated
  USING (is_studio_member(auth.uid(), studio_id))
  WITH CHECK (is_studio_member(auth.uid(), studio_id));

INSERT INTO storage.buckets (id, name, public)
VALUES ('studio-assets', 'studio-assets', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read studio-assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'studio-assets');

CREATE POLICY "Members upload studio-assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'studio-assets'
    AND is_studio_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "Members update studio-assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'studio-assets'
    AND is_studio_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );

CREATE POLICY "Members delete studio-assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'studio-assets'
    AND is_studio_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
  );
