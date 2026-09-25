begin;

do $test$
declare
  v_event_id text := 'evt_local_fencing_probe';
  v_first jsonb;
  v_busy jsonb;
  v_retry jsonb;
  v_duplicate jsonb;
  v_first_token uuid;
  v_retry_token uuid;
  v_state text;
  v_attempt_count integer;
  v_processing_token uuid;
begin
  delete from public.platform_billing_events where stripe_event_id = v_event_id;

  if has_function_privilege('anon', 'public.claim_stripe_webhook_event(text,text,uuid,jsonb,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.claim_stripe_webhook_event(text,text,uuid,jsonb,integer)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.claim_stripe_webhook_event(text,text,uuid,jsonb,integer)', 'EXECUTE') then
    raise exception 'claim_function_acl_invalid';
  end if;

  v_first := public.claim_stripe_webhook_event(v_event_id, 'invoice.paid', null, '{}'::jsonb, 120);
  if v_first->>'state' <> 'claimed' or nullif(v_first->>'token', '') is null then
    raise exception 'first_claim_invalid: %', v_first;
  end if;
  v_first_token := (v_first->>'token')::uuid;

  v_busy := public.claim_stripe_webhook_event(v_event_id, 'invoice.paid', null, '{}'::jsonb, 120);
  if v_busy->>'state' <> 'busy' then
    raise exception 'concurrent_claim_not_busy: %', v_busy;
  end if;

  if not public.fail_stripe_webhook_event(v_event_id, v_first_token, 'synthetic failure') then
    raise exception 'owned_failure_rejected';
  end if;

  v_retry := public.claim_stripe_webhook_event(v_event_id, 'invoice.paid', null, '{}'::jsonb, 120);
  if v_retry->>'state' <> 'claimed' or nullif(v_retry->>'token', '') is null then
    raise exception 'retry_claim_invalid: %', v_retry;
  end if;
  v_retry_token := (v_retry->>'token')::uuid;
  if v_retry_token = v_first_token then
    raise exception 'retry_token_not_rotated';
  end if;

  if public.complete_stripe_webhook_event(v_event_id, v_first_token) then
    raise exception 'stale_completion_was_not_fenced';
  end if;
  if public.fail_stripe_webhook_event(v_event_id, v_first_token, 'stale failure') then
    raise exception 'stale_failure_was_not_fenced';
  end if;
  if not public.complete_stripe_webhook_event(v_event_id, v_retry_token) then
    raise exception 'owned_completion_rejected';
  end if;

  v_duplicate := public.claim_stripe_webhook_event(v_event_id, 'invoice.paid', null, '{}'::jsonb, 120);
  if v_duplicate->>'state' <> 'processed' then
    raise exception 'processed_duplicate_not_idempotent: %', v_duplicate;
  end if;

  select processing_state, attempt_count, processing_token
  into v_state, v_attempt_count, v_processing_token
  from public.platform_billing_events
  where stripe_event_id = v_event_id;

  if v_state <> 'processed' or v_attempt_count <> 2 or v_processing_token is not null then
    raise exception 'final_claim_state_invalid: %, %, %', v_state, v_attempt_count, v_processing_token;
  end if;
end
$test$;

rollback;
