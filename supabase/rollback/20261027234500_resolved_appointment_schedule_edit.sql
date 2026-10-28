-- Run only if the candidate migration was applied and the Worker has been rolled back.
DROP FUNCTION IF EXISTS public.edit_resolved_appointment_schedule(
  uuid,uuid,text,timestamptz,integer,text,uuid
);
