ALTER TABLE public.studios
  ADD COLUMN IF NOT EXISTS deposit_percent integer NOT NULL DEFAULT 100
    CHECK (deposit_percent >= 0 AND deposit_percent <= 100);

COMMENT ON COLUMN public.studios.deposit_percent IS 'Percentagem do total cobrada como sinal online quando payment_policy = pre_payment. 100 = pagamento integral; <100 = sinal, restante pago no estúdio.';