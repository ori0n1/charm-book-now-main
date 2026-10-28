-- Run only after the new Worker version has been reverted.
DROP FUNCTION IF EXISTS public.edit_owner_resolved_appointment(
  uuid,uuid,text,timestamptz,jsonb,numeric,text,uuid
);
