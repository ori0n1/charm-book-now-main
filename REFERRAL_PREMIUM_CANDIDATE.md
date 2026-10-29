# Indique e Ganhe — candidato de 14 dias Premium

Base: commit `521ca10723d275bc5ac380f54468e2fbe7f42bf5`, correspondente à versão Cloudflare `dcf02180-34eb-4b6b-919a-5efc038292a3` confirmada em 2026-10-29.

## Regra comercial proposta

- Nova indicação criada após a migração: 14 dias de Premium para quem indica, se não pagar Premium, quando o novo estúdio mantiver uma assinatura Pro ou Premium ativa por 30 dias.
- Máximo de seis recompensas acumuladas por estúdio, incluindo créditos antigos ainda disponíveis ou aplicados.
- Dias Premium acumulados começam após um teste Premium não utilizado ou após dias já ganhos por indicação.
- Indicações anteriores à migração conservam o crédito prometido. O código antigo de Stripe continua apenas para essas indicações.
- Um estúdio que já paga Premium pode continuar a indicar, mas a indicação aprovada não gera dias adicionais. A interface declara essa condição.

## Verificações locais

- TypeScript sem erros; build de cliente e servidor concluído. A auditoria geral de responsividade iniciada pelo script de build foi interrompida depois da compilação; a validação visual direcionada passou a 1280 e 390 px.
- PostgreSQL local sintético: migração, preservação de indicações antigas, 14 dias, idempotência, empilhamento e limite de seis passaram.
- Nenhum SQL foi executado em produção. Nenhum Worker foi publicado.

## Rollback compatível preparado

O Worker antigo **não é um alvo de rollback** após a primeira indicação `premium_days`: pode emitir um crédito Stripe antes de o banco impedir a escrita. O código atual tem dois builds do mesmo candidato:

- Normal: `REFERRAL_PREMIUM_AWARDS_ENABLED` ausente ou diferente de `false`. Indicações `premium_days` são atribuídas pelo RPC após 30 dias e elegibilidade; apenas `legacy_credit` passa pelo crédito histórico.
- Rollback: `REFERRAL_PREMIUM_AWARDS_ENABLED=false node scripts/build-safe.mjs`. A classificação continua explícita. Indicações `premium_days` novas e pendentes ficam pendentes, sem crédito e sem concessão de dias; `legacy_credit` continua no processamento histórico. Tipos ausentes ou inesperados falham antes de qualquer chamada Stripe.

Artefactos finais locais, com a mesma configuração de produção verificada:

- Candidato: `tmp/referral-premium-active-v2.zip`, SHA-256 `CCA333AE6C7F4AD399409DEAEB23ED291EEFF69554ECF495E66F8E0CB3DBE7A2`.
- Rollback: `tmp/referral-premium-rollback-v2.zip`, SHA-256 `7765B3BFD658DC756D37FA1280D9F6165747EC14ADB2286D15F46C13BAACBCE3`.
- Configuração idêntica em ambos: `dist/server/wrangler.referral.production.json`, SHA-256 `23c6ac958b7a05c814b08c4bbceabf710d45e1069b7eae7f001e00950670c36b`. Os ZIPs anteriores neste `tmp/` são obsoletos.

O módulo servidor do candidato contém `premium_days → premium_award`; o do rollback contém `premium_days → premium_pending`. Ambos conservam `legacy_credit → legacy_credit`. Os ZIPs são locais; nenhuma versão foi carregada ou publicada na Cloudflare.

## Preflight final somente leitura (2026-10-29)

- Supabase: consulta exclusiva de `pg_catalog.pg_proc` pelo endpoint `/database/query/read-only`, com `current_user = supabase_read_only_user`. As funções ativas `get_or_create_referral_code` e `get_studio_id_by_referral_code` não são alteradas. `award_referral_premium` ainda não existe. Removido apenas o novo ramo dos grants e normalizada a grafia de `timestamptz`, a definição candidata de `studio_effective_plan_tier` é igual à definição ativa. A lógica atual de Pro, Premium, períodos pagos e teste mantém-se.
- Cloudflare OAuth: versão ativa `dcf02180-34eb-4b6b-919a-5efc038292a3` a 100%; 51 bindings, sendo 27 variáveis simples e 24 secrets. Os nomes, tipos e valores das variáveis simples coincidem entre settings e versão ativa; os 24 secrets foram comparados só por nome/tipo. As seis variáveis adicionais em `OFFICIAL_BASE.json` estão presentes. Runtime `2025-09-24` com `nodejs_compat`, cron `*/10 * * * *`, domínios `bellza.pt` e `www.bellza.pt`.
- Os três valores públicos `VITE_CONNECT_FINANCIAL_*` foram incorporados em ambos os builds. O primeiro par de ZIPs não os incorporava e foi substituído pelos artefactos finais acima. A configuração tem todas as 27 variáveis simples, exige os 24 secrets por nome e usa `keep_vars: true`; omite rotas/domínios para preservar os geridos na Cloudflare.
- `wrangler deploy --dry-run` passou para candidato e rollback, sem upload. Passaram 2 testes dos artefactos e 6 testes direcionados de acesso/classificação. Os testes PostgreSQL sintéticos anteriores continuam válidos: a migração, direitos antigos, 14 dias, idempotência, pendências em rollback, recuperação, exclusão de Premium pago, acumulação e limite de seis não sofreram alterações desde então.
- Nenhum ficheiro de Stripe, webhook de pagamentos ou alteração de assinatura foi modificado nesta validação. O candidato contém apenas a leitura do grant Premium no resumo de acesso; não muda cobranças nem planos pagos.

### Sequência de ativação futura

1. Confirmar por OAuth a versão ativa, o esquema efetivo de `studio_effective_plan_tier`, migrações e todas as configurações, rotas, triggers, bindings e secrets por nome/tipo. Validar o candidato e o ZIP contra a versão ativa. Obter autorização específica do proprietário antes de qualquer alteração em produção.
2. Aplicar a migração aditiva mantendo o Worker antigo ativo. As indicações inseridas por ele recebem `legacy_credit` por omissão e conservam a promessa anterior. A migração não remove dados nem créditos.
3. Publicar exatamente o build normal aprovado, preservando as configurações efetivas. Confirmar que recebe 100% do tráfego e verificar o programa sem cobranças reais nem alterações em dados de clientes durante o teste.

### Reversão futura, se necessária

1. Suspender a ativação do build normal e publicar **apenas** o build de rollback compatível verificado, com a mesma configuração efetiva, após autorização explícita para a reversão. Nunca selecionar a versão anterior à migração.
2. Confirmar via OAuth a versão e o tráfego ativos. Verificar: créditos antigos intactos, dias Premium já concedidos ativos até `ends_at`, novas indicações `premium_days` pendentes sem crédito, e ligações/códigos/contadores funcionais.
3. Manter a migração e todo o histórico. Não executar SQL de downgrade nem apagar `referral_premium_grants`. Resolver a causa da reversão e, após nova aprovação, reativar o build normal. Reconciliar as indicações Premium que amadureceram durante a pausa com o RPC idempotente, mediante operação controlada e autorização para escrita; uma assinatura anual pode não produzir outro webhook em breve.

### Estado

**APTO para solicitar aprovação de publicação destes artefactos**, desde que a versão ativa e os 51 bindings sejam reconfirmados imediatamente antes da operação. A sequência aprovada deverá aplicar a migração aditiva antes do candidato e manter o ZIP de rollback compatível disponível. A publicação e qualquer reversão exigem autorização específica do proprietário. Nenhuma migração, upload ou publicação foi feita nesta preparação.
