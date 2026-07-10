-- ============================================================
-- Staff current_status: manual availability override
-- Values: online | available | busy | absent
--   online    – immediate + future bookings allowed
--   available – future bookings only
--   busy      – occupied now; future free slots only
--   absent    – hidden from public; excluded from scheduling
-- ============================================================

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS current_status TEXT NOT NULL DEFAULT 'available'
  CHECK (current_status IN ('online', 'available', 'busy', 'absent'));

COMMENT ON COLUMN public.staff.current_status IS
  'Manual status: online=immed+future, available=future only, busy=active now, absent=hidden';

-- Allow authenticated studio members to update their own staff status
-- (the existing Members manage staff policy covers UPDATE already,
--  this is just a reminder comment — no new policy needed)
