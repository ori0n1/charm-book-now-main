# Identidades QA Bellza — registo e proposta

Estado: preparação local em 2026-11-16. Projeto Supabase de produção: `pwmdzpvnatrvfpgcvnzg`. Este ficheiro não contém credenciais e não autoriza escrita ou testes em produção.

## QA A — existente, preservar

Estúdio ativo `bellza-qa-e2663064`, ID `e2663064-7774-41c5-95cb-e5e6afc4fab4`. As três contas abaixo estão confirmadas no Supabase Auth, não estão bloqueadas, já tiveram autenticação anterior e não possuem `saas_owner`. Nenhum vínculo ou dado existente deve ser alterado.

| Conta (ID não secreto) | Papel | Finalidade |
| --- | --- | --- |
| `96a5a309-154e-41f5-ad52-f2c52bd3bed1` | `manager` | QA de gestão |
| `9aef1eae-90b1-4ae7-9c5f-aee93abfb212` | `staff` | QA profissional |
| `ec3128b3-a366-4358-afb6-cabd41b68e79` | `studio_owner` | QA de proprietário e futura prova RLS |

Sessões atuais das contas QA **não verificadas**. Autenticação anterior não prova que uma sessão esteja disponível agora.

## QA B — proposta, não criado

| Campo | Valor proposto |
| --- | --- |
| Conta Auth | `qa-owner-b-20261116@bellza.invalid` |
| Nome de apresentação | `Bellza QA B` |
| ID da conta | Gerado pelo Supabase Auth; registar após criação |
| Estúdio | `Bellza QA B`, slug `bellza-qa-b` |
| ID do estúdio | `2cc1683e-ab91-4488-a702-6a8feb60f379` |
| Papel | `studio_owner` somente neste estúdio; nunca `saas_owner` |
| Estado inicial | Estúdio inativo; conta permanente, sem sessão automática |
| Finalidade | Testes QA isolados de RLS, agenda e reservas; notificações e pagamentos apenas com simulação ou ambiente seguro autorizado |

Em 2026-11-16, não havia colisão para o email, nome, slug ou ID propostos. Reconfirmar imediatamente antes da criação. O domínio `.invalid` segue o padrão das três contas QA existentes e não recebe email: a senha única deve ser definida pelo proprietário e guardada num gestor seguro sob seu controlo. Sem senha, JWT, refresh token ou sessão no Git, relatórios, Telegram ou gateway.

O estúdio `teste` **não foi selecionado**: tinha um vínculo de utilizador sem marcador QA. As contagens consultadas de clientes, appointments, booking requests, payment intents, subscriptions, logs de notificações, notificações de estúdio, staff e services foram zero, mas isso não comprova uso exclusivo em QA.

### Objetos e efeitos da criação proposta

1. Criar **uma** conta por Supabase Auth Admin, pelo método oficial de criação de utilizador, com o email acima, senha única e nome `Bellza QA B`, sem convite por email. Não inserir diretamente em `auth.users`. Auth cria seus registos internos; o gatilho ativo `on_auth_user_created` cria **uma** linha em `public.profiles`, sem telefone.
2. Numa transação administrativa especificamente aprovada, criar **uma** linha em `public.studios` com o ID, nome e slug acima, `is_active=false`, `plan_tier='free'`, `subscription_status='canceled'` e `trial_ends_at='2000-01-01T00:00:00Z'`. O gatilho ativo cria **uma** linha em `public.whatsapp_studio_entitlements`: a definição ativa devolve `inactive` para um trial terminado. Não definir campos `trial_identity_*`.
3. Na mesma transação, criar **uma** linha em `public.user_roles` para o ID Auth recém-criado, o ID de QA B e `role='studio_owner'`. O gatilho `claim_whatsapp_trial_for_owner` só faz claims com entitlement `trial`; portanto, não deve criar linhas em `public.whatsapp_trial_identity_claims`. Confirmar isso antes de concluir a operação.
4. Não criar clientes, staff, serviços, reservas, pagamentos, subscrições, mensagens, contactos nem dados de estúdios reais. Nenhuma função de criação acima mostrou chamada externa na revisão da definição; isto não substitui a verificação imediatamente após a criação.

Método previsto: usar a sessão administrativa legítima no Supabase Dashboard. A conta deve ser criada pela função oficial de Supabase Auth Admin, sem convite ou email de confirmação e sem inserir em `auth.users` por SQL. O proprietário introduz e guarda a senha única sem a transmitir à Codex. A transação de `studios`/`user_roles` exige capacidade administrativa de escrita no SQL Editor, mas **não** exige GRANT, nova role ou alteração de RLS. Não fornecer `service_role` a agentes ou ao gateway. A [documentação oficial de Auth Admin](https://supabase.com/docs/reference/javascript/auth-admin-createuser) descreve `createUser` e `email_confirm`; confirmar a opção equivalente no Dashboard antes de qualquer envio.

O SQL de dados para os itens 2–3 só poderá ser finalizado com o ID devolvido por Auth e executado após aprovação específica. A criação da conta e a transação de dados são **duas escritas distintas** no projeto de produção; nenhuma está autorizada por este registo. Pré-condições: reconfirmar ausência de colisões e não executar se a UI apenas oferecer convite por email.

```sql
-- PROPOSTA: NÃO EXECUTAR. Substituir <UUID_AUTH_QA_B> após criação oficial em Auth.
BEGIN;
INSERT INTO public.studios
  (id, slug, name, is_active, plan_tier, subscription_status, trial_ends_at)
VALUES
  ('2cc1683e-ab91-4488-a702-6a8feb60f379', 'bellza-qa-b',
   'Bellza QA B', false, 'free', 'canceled', '2000-01-01T00:00:00Z');
INSERT INTO public.user_roles (user_id, studio_id, role)
VALUES ('<UUID_AUTH_QA_B>', '2cc1683e-ab91-4488-a702-6a8feb60f379',
        'studio_owner');
DO $qa$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.whatsapp_studio_entitlements
    WHERE studio_id = '2cc1683e-ab91-4488-a702-6a8feb60f379'
      AND status = 'inactive'
  ) OR EXISTS (
    SELECT 1 FROM public.whatsapp_trial_identity_claims
    WHERE studio_id = '2cc1683e-ab91-4488-a702-6a8feb60f379'
  ) THEN
    RAISE EXCEPTION 'qa_b_whatsapp_isolation_failed';
  END IF;
END
$qa$;
COMMIT;
```

O bloco inclui uma asserção transacional que aborta a criação do estúdio/vínculo se o WhatsApp não estiver inativo ou houver claims de trial. Ainda falta substituir o marcador do ID Auth e reconfirmar os gatilhos/constraints antes de qualquer execução. A senha e o ID Auth não serão colocados neste ficheiro.

### Visibilidade, reversão e ativação futura

Na implementação local revista, `is_active=true` torna o estúdio enumerável no sitemap público; a Sentinela descobre páginas públicas a partir dessa lista. A correspondência com o Worker ativo não foi revista nesta etapa. Por prudência, a proposta mantém QA B inativo. As políticas RLS ativas exigem estúdio ativo para o acesso funcional; o teste real entre QA A e QA B exigirá autorização posterior para ativar QA B e para executar os GETs. O estado `free/canceled` pode limitar testes de funcionalidades pagas; qualquer mudança de plano exigirá análise e autorização próprias. Uma conta permanente não concede aos agentes automáticos credencial de escrita ou sessão pessoal.

Se a transação de estúdio/vínculo falhar, `ROLLBACK` preserva QA A; a conta Auth recém-criada permanece sem estúdio até decisão específica. Após criação concluída, **não eliminar automaticamente** conta ou estúdio: suspender uso e pedir autorização para qualquer desativação ou remoção, verificando previamente dados dependentes. Não tocar em Studio 27, Capivara ou demais estúdios.

Para a futura prova RLS, usar a conta `studio_owner` QA A acima e QA B por login legítimo, em sessões separadas. Consultar primeiro apenas identidade e vínculo; depois, mediante autorização própria, GETs de `appointments` (`studio_id,status,starts_at`, próximos 30 minutos) e `booking_payment_requests` (`studio_id,status,created_at`, últimos 30 minutos), para estúdio próprio e cruzado. Guardar apenas contagens e decisões de acesso. Se não houver linhas próprias na janela, marcar o isolamento da tabela **INDETERMINADO**. Não ativar a API privada nem armazenar sessões no gateway.
