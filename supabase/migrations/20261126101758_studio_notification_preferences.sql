-- Preferences belong to a recipient, never to the whole studio. Missing rows mean enabled.
CREATE TABLE public.studio_notification_preferences (
  studio_id uuid NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'new_appointments', 'reschedules', 'cancellations', 'pending', 'payments',
    'reminders', 'clients', 'reviews', 'other'
  )),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (studio_id, user_id, category)
);

CREATE INDEX studio_notification_preferences_user_idx
  ON public.studio_notification_preferences (user_id, studio_id);

ALTER TABLE public.studio_notification_preferences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.studio_notification_preferences TO authenticated;

CREATE POLICY "Owners read own notification preferences"
  ON public.studio_notification_preferences FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.studio_id = studio_notification_preferences.studio_id
        AND r.user_id = (SELECT auth.uid())
        AND r.role IN ('studio_owner', 'saas_owner')
    )
  );

CREATE POLICY "Owners insert own notification preferences"
  ON public.studio_notification_preferences FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.studio_id = studio_notification_preferences.studio_id
        AND r.user_id = (SELECT auth.uid())
        AND r.role IN ('studio_owner', 'saas_owner')
    )
  );

CREATE POLICY "Owners update own notification preferences"
  ON public.studio_notification_preferences FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.studio_id = studio_notification_preferences.studio_id
        AND r.user_id = (SELECT auth.uid())
        AND r.role IN ('studio_owner', 'saas_owner')
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.studio_id = studio_notification_preferences.studio_id
        AND r.user_id = (SELECT auth.uid())
        AND r.role IN ('studio_owner', 'saas_owner')
    )
  );
