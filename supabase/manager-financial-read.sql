CREATE OR REPLACE FUNCTION public.financial_privacy_global_visible(
  p_user_id uuid, p_studio_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles r
      WHERE r.user_id = p_user_id AND r.studio_id = p_studio_id
        AND r.role::text IN ('saas_owner', 'studio_owner', 'manager')
    )
    AND (
      NOT EXISTS (
        SELECT 1 FROM public.financial_privacy_settings s
        WHERE s.studio_id = p_studio_id AND s.enabled
      )
      OR EXISTS (
        SELECT 1 FROM public.financial_privacy_unlocks u
        WHERE u.studio_id = p_studio_id AND u.user_id = p_user_id
          AND u.session_id = auth.jwt()->>'session_id'
          AND u.expires_at > now()
      )
    )
$$;
