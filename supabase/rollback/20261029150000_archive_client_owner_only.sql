-- Safe only before any client has been archived. Never restore anonymized personal data.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.clients WHERE archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'client_archive_rollback_requires_compatible_app';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS guard_client_archive_marker ON public.clients;
DROP FUNCTION IF EXISTS public.guard_client_archive_marker();
DROP TRIGGER IF EXISTS prevent_client_hard_delete ON public.clients;
DROP FUNCTION IF EXISTS public.prevent_client_hard_delete();
DROP FUNCTION IF EXISTS public.archive_client_for_owner(uuid, uuid, text);
ALTER TABLE public.clients DROP COLUMN IF EXISTS archived_at;
