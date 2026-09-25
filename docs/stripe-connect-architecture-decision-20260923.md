# Decisão de arquitetura Stripe Connect — staging

Data: 23/09/2026
Escopo: novas Connected Accounts criadas exclusivamente em Stripe Test Mode.
Produção, Stripe Live e contas Express existentes: fora do escopo e intocados.

## Requisitos invariantes

- O sinal é um pagamento do cliente ao estúdio e deve ser um Direct Charge da Connected Account do estúdio.
- Bellza application fee é sempre zero.
- A Connected Account suporta a fee de processamento.
- Stripe, e não Bellza, assume a responsabilidade pelo saldo negativo da Connected Account.
- O vínculo `studio_id → account → PaymentIntent → Charge → Balance Transaction` é único e verificado no servidor.
- Nenhum identificador enviado pelo browser substitui o vínculo carregado do banco.

## Comparação

| Alternativa | Fees/perdas | KYC e Dashboard | Refunds/disputes | Complexidade e risco | Decisão |
| --- | --- | --- | --- | --- | --- |
| Express atual + Direct Charges | `fees.payer=application`; `losses.payments=application` | Stripe coleta requisitos; Dashboard Express | Bellza permanece economicamente exposta conforme o controller | Incompatível com o requisito; o guard atual já bloqueia | **Rejeitada para novas contas** |
| Standard/full-dashboard Accounts v1 + Direct Charges | `fees.payer=account`; `losses.payments=stripe` | Stripe coleta KYC; titular usa Dashboard completo | Charge/refund/dispute e Balance Transaction pertencem à conta conectada; saldo negativo sob responsabilidade Stripe | Reaproveita PaymentIntents, webhooks, account IDs e reconciliação atuais; menor delta | **Escolhida para staging** |
| Accounts v2, Merchant + `dashboard=full`, collectors Stripe + Direct Charges | `fees_collector=stripe`; `losses_collector=stripe` | Stripe coleta KYC; Dashboard completo | Mesmo resultado econômico pretendido | Requer novo modelo de Account, onboarding/eventos/status/capabilities v2 e adaptação de sincronização. O SDK atual não expõe MB WAY na configuração Merchant v2 | **Adequada no futuro, não escolhida agora** |

Destination Charges e Separate Charges and Transfers não foram escolhidos: colocariam o Charge ou o débito de fees/refunds/chargebacks na plataforma e aumentariam a reconciliação sem benefício para um sinal destinado a exatamente um estúdio.

## Responsabilidades no modelo escolhido

- **Stripe fee:** debitada da Connected Account porque o Direct Charge é criado no contexto dela e o controller deve confirmar `fees.payer=account`.
- **Application fee Bellza:** zero; o código não envia `application_fee_amount`.
- **Refund total/parcial:** criado no contexto da mesma Connected Account. A reconciliação relê Refund e Charge atuais e atualiza o total reembolsado.
- **Disputa/chargeback:** evento Connect e objeto Dispute são recuperados no contexto da mesma conta. O guard exige `losses.payments=stripe`.
- **Negative balance:** responsabilidade Stripe conforme o controller; a Bellza continua responsável somente pelo próprio saldo de plataforma.
- **SCA/3DS:** tratado pelo PaymentIntent/Checkout da Connected Account; não altera propriedade, fee ou vínculo do pagamento.
- **KYC:** coletado pela Stripe no onboarding hospedado; a Bellza não armazena documentos KYC.
- **Capabilities:** `card_payments`, `mb_way_payments` e `transfers` são solicitadas antes do primeiro Account Link. Cobranças permanecem bloqueadas até capability, charges e payouts estarem ativos.
- **Ownership:** autorização owner da Bellza, unique constraint de account no banco, metadata `studio_id`, controller fresco e contexto `Stripe-Account` são verificados antes da cobrança.

## Riscos e impacto sobre contas Express existentes

1. Standard/full exige **novo onboarding/KYC** para cada nova conta. Não existe conversão automática segura de Express para Standard/full.
2. As responsabilidades de fees/losses são definidas na criação/configuração e não devem ser tratadas como mutáveis depois.
3. Um estúdio Express existente deve manter o account ID e o histórico atuais. Ele não será recriado, substituído ou desvinculado por este trabalho.
4. Migrar um estúdio existente no futuro exigirá conta nova, onboarding novo, janela de corte, bloqueio de novos pagamentos na conta antiga e preservação permanente do vínculo histórico de cada PaymentIntent à conta original.
5. Standard/full não aceita Login Links do Express; o titular entra diretamente no Dashboard Stripe. O código deve suportar ambos sem tentar converter um no outro.
6. Se a Stripe devolver controller diferente de `account/stripe/full`, a conta não é persistida no estúdio e nenhuma cobrança é liberada. A criação usa idempotency key por ambiente/estúdio para evitar contas duplicadas em retry.

## Guardas de implementação autorizada

- Criação de novas contas fica habilitada somente quando `STRIPE_ENV=sandbox` e `STRIPE_CONNECT_NEW_ACCOUNT_MODEL=standard_full_v1`.
- Qualquer tentativa de criar nova conta em Live falha antes da chamada Stripe.
- Contas já vinculadas não entram no ramo de criação e não têm o tipo/controller alterado.
- Nenhuma conta será criada até existir chave Stripe Test Mode e o fluxo ser iniciado por owner autenticado no Worker staging.

## Referências oficiais

- [Configure connected account behaviour](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
- [Create an Account](https://docs.stripe.com/api/accounts/create)
- [Design a Connect integration](https://docs.stripe.com/connect/design-an-integration)
- [Direct Charges](https://docs.stripe.com/connect/direct-charges)
- [Connect disputes](https://docs.stripe.com/connect/disputes)
- [Account Links](https://docs.stripe.com/api/account_links)
