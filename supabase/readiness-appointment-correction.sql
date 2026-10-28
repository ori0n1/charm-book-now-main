SELECT jsonb_build_object(
  'appointment_columns', (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='appointments'
      AND column_name IN ('id','studio_id','status','cancellation_reason','cancelled_at','cancelled_by','attendance_resolved_at','attendance_resolved_by','updated_at')
  ),
  'cash_columns', (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cash_register_movements'
      AND column_name IN ('id','studio_id','appointment_id','movement_type','payment_method','amount')
  ),
  'audit_columns', (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND table_name='financial_audit_logs'
      AND column_name IN ('studio_id','actor_user_id','entity_type','entity_id','action','amount_cents','metadata')
  ),
  'statuses', (
    SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
    FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='appointment_status'
  ),
  'attendance_rpc', to_regprocedure('public.correct_appointment_attendance(uuid,uuid,text,uuid)') IS NOT NULL,
  'cancel_rpc', to_regprocedure('public.cancel_completed_appointment(uuid,uuid,text)') IS NOT NULL,
  'new_action_rpc', to_regprocedure('public.correct_owner_appointment_action(uuid,uuid,text,uuid,text)') IS NOT NULL,
  'new_method_rpc', to_regprocedure('public.correct_onsite_payment_method(uuid,uuid,uuid,text,uuid)') IS NOT NULL,
  'cancel_guard', to_regprocedure('public.guard_completed_appointment_cancellation()') IS NOT NULL,
  'appointments_count', (SELECT count(*) FROM public.appointments),
  'movements_count', (SELECT count(*) FROM public.cash_register_movements),
  'payment_intents_count', (SELECT count(*) FROM public.payment_intents)
) AS readiness;
