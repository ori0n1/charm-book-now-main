CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_unique_stripe_payment_intent
  ON public.payment_intents(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_unique_checkout_session
  ON public.payment_intents(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_one_succeeded_booking_request
  ON public.payment_intents(booking_request_id)
  WHERE booking_request_id IS NOT NULL
    AND status = 'succeeded';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_one_succeeded_appointment
  ON public.payment_intents(appointment_id)
  WHERE appointment_id IS NOT NULL
    AND status = 'succeeded';

CREATE OR REPLACE FUNCTION public.audit_payment_intent_succeeded()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status <> 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'succeeded' THEN
    RETURN NEW;
  END IF;

  IF NEW.appointment_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.financial_audit_logs (
    studio_id,
    actor_user_id,
    entity_type,
    entity_id,
    action,
    amount_cents,
    currency,
    metadata
  )
  SELECT
    NEW.studio_id,
    NULL,
    'payment_intent',
    NEW.id,
    'booking_deposit_succeeded',
    NEW.amount_cents,
    COALESCE(NEW.currency, 'eur'),
    jsonb_build_object(
      'appointment_id', NEW.appointment_id,
      'booking_request_id', NEW.booking_request_id,
      'stripe_payment_intent_id', NEW.stripe_payment_intent_id,
      'stripe_checkout_session_id', NEW.stripe_checkout_session_id,
      'method', NEW.method
    )
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.financial_audit_logs existing
    WHERE existing.entity_type = 'payment_intent'
      AND existing.entity_id = NEW.id
      AND existing.action = 'booking_deposit_succeeded'
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_payment_intent_succeeded_insert ON public.payment_intents;
CREATE TRIGGER trg_audit_payment_intent_succeeded_insert
  AFTER INSERT ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_intent_succeeded();

DROP TRIGGER IF EXISTS trg_audit_payment_intent_succeeded_update ON public.payment_intents;
CREATE TRIGGER trg_audit_payment_intent_succeeded_update
  AFTER UPDATE OF status, appointment_id ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_intent_succeeded();

REVOKE ALL ON FUNCTION public.audit_payment_intent_succeeded() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_payment_intent_succeeded() TO service_role;
