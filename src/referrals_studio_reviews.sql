-- ========================================================
-- Studio Reviews System
-- Run this in Supabase SQL Editor (safe to re-run)
-- ========================================================

-- 1. Add reviews_count to staff table (if not already present)
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS reviews_count INTEGER NOT NULL DEFAULT 0;

-- 2. Create studio_reviews table
CREATE TABLE IF NOT EXISTS public.studio_reviews (
  id            UUID          DEFAULT gen_random_uuid() PRIMARY KEY,
  studio_id     UUID          NOT NULL REFERENCES public.studios(id) ON DELETE CASCADE,
  user_id       UUID          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appointment_id UUID         REFERENCES public.appointments(id) ON DELETE SET NULL,
  rating        SMALLINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  staff_ids     UUID[]        NOT NULL DEFAULT '{}',
  reviewer_name TEXT,
  created_at    TIMESTAMPTZ   DEFAULT now(),
  UNIQUE(user_id, appointment_id)
);

-- 3. Row Level Security
ALTER TABLE public.studio_reviews ENABLE ROW LEVEL SECURITY;

-- Drop existing policies before recreating (idempotent)
DROP POLICY IF EXISTS "Public can read reviews"  ON public.studio_reviews;
DROP POLICY IF EXISTS "Users insert own reviews" ON public.studio_reviews;

-- Anyone can read reviews (public page shows them)
CREATE POLICY "Public can read reviews"
  ON public.studio_reviews FOR SELECT USING (true);

-- Only the author can insert their own review
-- (server functions use service-role and bypass RLS; this protects direct client access)
CREATE POLICY "Users insert own reviews"
  ON public.studio_reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_studio_reviews_studio_id   ON public.studio_reviews(studio_id);
CREATE INDEX IF NOT EXISTS idx_studio_reviews_user_id     ON public.studio_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_studio_reviews_appointment ON public.studio_reviews(appointment_id);

-- 5. Trigger function: recalculate studio rating + staff ratings
--    Uses correlated subqueries per staff member so ALL reviews for that
--    staff member are counted, not just those overlapping the current row.
CREATE OR REPLACE FUNCTION public.refresh_studio_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_studio_id UUID;
BEGIN
  -- On DELETE the relevant studio_id is in OLD; on INSERT/UPDATE it's in NEW
  v_studio_id := COALESCE(NEW.studio_id, OLD.studio_id);

  -- ── 1. Recalculate studio aggregate ─────────────────────
  UPDATE public.studios
  SET
    rating        = (
      SELECT ROUND(AVG(rating)::numeric, 1)
      FROM public.studio_reviews
      WHERE studio_id = v_studio_id
    ),
    reviews_count = (
      SELECT COUNT(*)
      FROM public.studio_reviews
      WHERE studio_id = v_studio_id
    )
  WHERE id = v_studio_id;

  -- ── 2. Recalculate each tagged staff member's aggregate ──
  --    Determine which staff IDs are affected by this change.
  --    On INSERT: update staff in NEW.staff_ids.
  --    On DELETE: update staff in OLD.staff_ids.
  --    On UPDATE: update staff in the union of OLD and NEW staff_ids.
  UPDATE public.staff s
  SET
    rating = (
      SELECT ROUND(AVG(r.rating)::numeric, 1)
      FROM public.studio_reviews r
      WHERE r.studio_id = v_studio_id
        AND s.id = ANY(r.staff_ids)
    ),
    reviews_count = (
      SELECT COUNT(*)
      FROM public.studio_reviews r
      WHERE r.studio_id = v_studio_id
        AND s.id = ANY(r.staff_ids)
    )
  WHERE s.studio_id = v_studio_id
    AND (
      (TG_OP = 'INSERT' AND s.id = ANY(NEW.staff_ids))
   OR (TG_OP = 'DELETE' AND s.id = ANY(OLD.staff_ids))
   OR (TG_OP = 'UPDATE' AND (s.id = ANY(NEW.staff_ids) OR s.id = ANY(OLD.staff_ids)))
    );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 6. Attach trigger for INSERT, UPDATE, DELETE
DROP TRIGGER IF EXISTS trg_refresh_studio_rating ON public.studio_reviews;
CREATE TRIGGER trg_refresh_studio_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.studio_reviews
  FOR EACH ROW EXECUTE FUNCTION public.refresh_studio_rating();
