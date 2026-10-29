-- Preserve all historical foreign keys and financial records. Only the client profile is anonymized.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE OR REPLACE FUNCTION public.archive_client_for_owner(
  p_studio_id uuid,
  p_client_id uuid,
  p_confirmation text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
BEGIN
  IF p_confirmation IS DISTINCT FROM 'EXCLUIR' THEN
    RAISE EXCEPTION 'client_archive_confirmation_required';
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND studio_id = p_studio_id AND role = 'studio_owner'
  ) THEN
    RAISE EXCEPTION 'studio_owner_required';
  END IF;

  SELECT * INTO v_client FROM public.clients
  WHERE id = p_client_id AND studio_id = p_studio_id FOR UPDATE;
  IF NOT FOUND OR v_client.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'client_not_found';
  END IF;
  IF v_client.auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'client_archive_linked_account';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointments
    WHERE client_id = p_client_id AND studio_id = p_studio_id AND starts_at >= now()
  ) THEN
    RAISE EXCEPTION 'client_archive_future_appointment';
  END IF;

  PERFORM set_config('bellza.client_archive_confirmed', 'yes', true);
  UPDATE public.clients SET
    name = 'Cliente excluído',
    phone = replace(p_client_id::text, '-', ''),
    email = NULL,
    notes = NULL,
    date_of_birth = NULL,
    avatar_url = NULL,
    archived_at = now()
  WHERE id = p_client_id AND studio_id = p_studio_id;
  PERFORM set_config('bellza.client_archive_confirmed', '', true);
END;
$$;

REVOKE ALL ON FUNCTION public.archive_client_for_owner(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_client_for_owner(uuid, uuid, text) TO authenticated;

-- A direct REST DELETE must never cascade into appointments or financial history.
CREATE OR REPLACE FUNCTION public.prevent_client_hard_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'client_hard_delete_forbidden';
END;
$$;
DROP TRIGGER IF EXISTS prevent_client_hard_delete ON public.clients;
CREATE TRIGGER prevent_client_hard_delete BEFORE DELETE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.prevent_client_hard_delete();

-- Guard the archive marker even when clients UPDATE is granted to another role.
CREATE OR REPLACE FUNCTION public.guard_client_archive_marker()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL AND (
    NEW.name IS DISTINCT FROM OLD.name OR NEW.phone IS DISTINCT FROM OLD.phone
    OR NEW.email IS DISTINCT FROM OLD.email OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth
    OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
    OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
  ) THEN
    RAISE EXCEPTION 'client_archived_readonly';
  END IF;
  IF NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    IF NEW.archived_at IS NULL
       OR current_setting('bellza.client_archive_confirmed', true) IS DISTINCT FROM 'yes'
       OR NEW.name IS DISTINCT FROM 'Cliente excluído'
       OR NEW.phone IS DISTINCT FROM replace(OLD.id::text, '-', '')
       OR NEW.email IS NOT NULL OR NEW.notes IS NOT NULL OR NEW.date_of_birth IS NOT NULL
       OR NEW.avatar_url IS NOT NULL
       OR auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND studio_id = OLD.studio_id AND role = 'studio_owner'
    ) THEN
      RAISE EXCEPTION 'studio_owner_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_client_archive_marker ON public.clients;
CREATE TRIGGER guard_client_archive_marker BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.guard_client_archive_marker();
