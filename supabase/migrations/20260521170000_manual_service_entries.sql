CREATE TABLE IF NOT EXISTS public.manual_service_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  studio_id UUID NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE RESTRICT,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE RESTRICT,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash','mb_way','multibanco','card','bank_transfer','other')),
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','walk_in')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manual_service_entries_studio_date
  ON public.manual_service_entries(studio_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_service_entries_staff_date
  ON public.manual_service_entries(staff_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_manual_service_entries_client
  ON public.manual_service_entries(client_id);

DROP TRIGGER IF EXISTS trg_manual_service_entries_updated_at ON public.manual_service_entries;
CREATE TRIGGER trg_manual_service_entries_updated_at
  BEFORE UPDATE ON public.manual_service_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.manual_service_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members manage manual service entries" ON public.manual_service_entries;
CREATE POLICY "Members manage manual service entries" ON public.manual_service_entries
  FOR ALL TO authenticated
  USING (public.is_studio_member(auth.uid(), studio_id))
  WITH CHECK (public.is_studio_member(auth.uid(), studio_id));

CREATE OR REPLACE FUNCTION public.update_client_totals_from_manual_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.client_id IS NOT NULL THEN
    UPDATE public.clients
    SET
      total_visits = total_visits + 1,
      total_spent = total_spent + NEW.amount,
      updated_at = now()
    WHERE id = NEW.client_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.client_id IS NOT NULL THEN
      UPDATE public.clients
      SET
        total_visits = GREATEST(0, total_visits - 1),
        total_spent = GREATEST(0, total_spent - OLD.amount),
        updated_at = now()
      WHERE id = OLD.client_id;
    END IF;
    IF NEW.client_id IS NOT NULL THEN
      UPDATE public.clients
      SET
        total_visits = total_visits + 1,
        total_spent = total_spent + NEW.amount,
        updated_at = now()
      WHERE id = NEW.client_id;
    END IF;
  ELSIF TG_OP = 'DELETE' AND OLD.client_id IS NOT NULL THEN
    UPDATE public.clients
    SET
      total_visits = GREATEST(0, total_visits - 1),
      total_spent = GREATEST(0, total_spent - OLD.amount),
      updated_at = now()
    WHERE id = OLD.client_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_manual_service_entries_client_totals ON public.manual_service_entries;
CREATE TRIGGER trg_manual_service_entries_client_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.manual_service_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_client_totals_from_manual_entry();
