UPDATE public.studios
SET whatsapp_default_message =
  'Olá, {nome_cliente}. Confirmamos a sua marcação de {serviço} com {profissional} para {data} às {hora}.' ||
  E'\n\nPode consultar os detalhes, remarcar, cancelar ou solicitar reembolso pelo link abaixo:\n{link_agendamento}'
WHERE whatsapp_default_message IS NULL
   OR whatsapp_default_message NOT LIKE '%{link_agendamento}%';
