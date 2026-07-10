ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS staff_agenda_visibility TEXT NOT NULL DEFAULT 'private';

ALTER TABLE public.studios
  DROP CONSTRAINT IF EXISTS studios_staff_agenda_visibility_check;

ALTER TABLE public.studios
  ADD CONSTRAINT studios_staff_agenda_visibility_check
  CHECK (staff_agenda_visibility IN ('private', 'team_busy', 'team_basic'));

COMMENT ON COLUMN public.studios.staff_agenda_visibility IS
  'Controls what staff users can see in the admin agenda: private, team_busy, or team_basic.';
