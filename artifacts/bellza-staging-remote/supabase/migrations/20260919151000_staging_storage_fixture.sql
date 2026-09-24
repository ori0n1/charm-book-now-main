-- STAGING-ONLY fixture: reproduces bucket metadata and storage.objects policies
-- seen in the production project on 2026-09-19. Copies no user objects.
-- Apply only to an isolated staging project, never to production.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('logo-bellza.png', 'logo-bellza.png', true, NULL, NULL),
  ('studio-assets', 'studio-assets', true, 26214400,
   ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Members delete studio-assets" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid));
CREATE POLICY "Members update studio-assets" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid))
  WITH CHECK (bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid));
CREATE POLICY "Members upload studio-assets" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'studio-assets'
    AND public.can_use_studio(auth.uid(), ((storage.foldername(name))[1])::uuid));
CREATE POLICY "Public read studio-assets" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'studio-assets');
