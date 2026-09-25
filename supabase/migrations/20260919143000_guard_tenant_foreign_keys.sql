-- Guard every existing single-column FK between two public tenant-owned tables.
-- A read-only inventory on 2026-09-19 found zero cross-studio matches in all
-- 44 covered relationships. This migration adds triggers; it rewrites no rows.
CREATE OR REPLACE FUNCTION public.assert_tenant_foreign_key()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_reference_id uuid;
  v_matches boolean;
BEGIN
  v_reference_id := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF v_reference_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.studio_id IS NULL THEN
    RAISE EXCEPTION 'tenant_fk_missing_studio' USING ERRCODE = '23514';
  END IF;
  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM public.%I parent WHERE parent.%I = $1 AND parent.studio_id = $2)',
    TG_ARGV[1], TG_ARGV[2]
  ) INTO v_matches USING v_reference_id, NEW.studio_id;
  IF NOT v_matches THEN
    RAISE EXCEPTION 'tenant_fk_mismatch: %.%', TG_TABLE_NAME, TG_ARGV[0]
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_tenant_foreign_key() FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  link record;
  link_count integer := 0;
BEGIN
  FOR link IN
    SELECT child.relname AS child_table, parent.relname AS parent_table,
      child_column.attname AS child_column, parent_column.attname AS parent_column
    FROM pg_constraint fk
    JOIN pg_class child ON child.oid = fk.conrelid
    JOIN pg_class parent ON parent.oid = fk.confrelid
    JOIN pg_attribute child_column
      ON child_column.attrelid = child.oid AND child_column.attnum = fk.conkey[1]
    JOIN pg_attribute parent_column
      ON parent_column.attrelid = parent.oid AND parent_column.attnum = fk.confkey[1]
    WHERE fk.contype = 'f'
      AND fk.connamespace = 'public'::regnamespace
      AND array_length(fk.conkey, 1) = 1
      AND child_column.attname <> 'studio_id'
      AND EXISTS (SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = child.oid AND a.attname = 'studio_id' AND NOT a.attisdropped)
      AND EXISTS (SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = parent.oid AND a.attname = 'studio_id' AND NOT a.attisdropped)
    ORDER BY child.relname, child_column.attname
  LOOP
    link_count := link_count + 1;
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF %I, studio_id ON public.%I '
      || 'FOR EACH ROW EXECUTE FUNCTION public.assert_tenant_foreign_key(%L, %L, %L)',
      'trg_tenant_fk_' || link.child_column,
      link.child_column, link.child_table,
      link.child_column, link.parent_table, link.parent_column
    );
  END LOOP;
  IF link_count <> 44 THEN
    RAISE EXCEPTION 'tenant_fk_schema_drift: expected 44, found %', link_count;
  END IF;
END
$migration$;

-- Otherwise a parent could be moved after a valid child link was created.
CREATE TRIGGER trg_cash_register_sessions_studio_immutable
  BEFORE UPDATE OF studio_id ON public.cash_register_sessions
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_customer_referrals_studio_immutable
  BEFORE UPDATE OF studio_id ON public.customer_referrals
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_push_subscriptions_studio_immutable
  BEFORE UPDATE OF studio_id ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_service_categories_studio_immutable
  BEFORE UPDATE OF studio_id ON public.service_categories
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_studio_notifications_studio_immutable
  BEFORE UPDATE OF studio_id ON public.studio_notifications
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
CREATE TRIGGER trg_whatsapp_message_logs_studio_immutable
  BEFORE UPDATE OF studio_id ON public.whatsapp_message_logs
  FOR EACH ROW EXECUTE FUNCTION public.reject_tenant_reassignment();
