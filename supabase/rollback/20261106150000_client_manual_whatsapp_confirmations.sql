-- Reverter o Worker primeiro. Não apagar confirmações reais.
DO $$
DECLARE has_rows boolean;
BEGIN
  IF to_regclass('public.client_manual_whatsapp_confirmations') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.client_manual_whatsapp_confirmations)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'A tabela contém confirmações; preserve os dados e reverta apenas o Worker.';
    END IF;
    EXECUTE 'DROP TABLE public.client_manual_whatsapp_confirmations';
  END IF;
END;
$$;
