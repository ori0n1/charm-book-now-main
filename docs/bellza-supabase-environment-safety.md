# STAGING ONLY — PRODUCTION REQUIRES EXPLICIT HUMAN AUTHORIZATION

Este repositório não autoriza qualquer mutação em produção. Não executar
`supabase link`, `db push`, `migration up`, `migration repair`, SQL remoto,
deploy de Functions, alteração de secrets ou manutenção administrativa fora do
staging sem uma autorização humana nova, explícita e específica.

## Identidades dos ambientes

| Ambiente                        | Project ref            | URL / seleção                                | Worker                                                  | Stripe                |
| ------------------------------- | ---------------------- | -------------------------------------------- | ------------------------------------------------------- | --------------------- |
| Local                           | `bellza-local`         | `supabase/config.toml`; não é projeto remoto | nenhum                                                  | nenhum                |
| Staging autorizado              | `qflwsdrgdkkcxjnbxmis` | `https://qflwsdrgdkkcxjnbxmis.supabase.co`   | `tanstack-start-app-staging`, `workers.dev`, sem routes | `sandbox` / Test Mode |
| Produção — proibida neste fluxo | `pwmdzpvnatrvfpgcvnzg` | configuração raiz de produção do Worker      | `tanstack-start-app`, `bellza.pt`                       | `live`                |

O estado local de link `supabase/.temp` é descartável, está ignorado pelo Git e
não é uma fonte autorizada de destino. Um link existente faz operações
mutáveis protegidas falharem, mesmo quando aponta para staging.

## Preflight obrigatório

Rotinas administrativas de staging devem importar
`scripts/lib/staging-supabase-guard.mjs` e fornecer, explicitamente:

```text
EXPECTED_SUPABASE_PROJECT_REF=qflwsdrgdkkcxjnbxmis
TARGET_SUPABASE_PROJECT_REF=qflwsdrgdkkcxjnbxmis
STAGING_SUPABASE_URL=https://qflwsdrgdkkcxjnbxmis.supabase.co
```

Para acesso direto ao banco também é obrigatório `STAGING_DATABASE_URL`. O
guard extrai o project ref do host ou utilizador do pooler e rejeita URL sem
vínculo verificável com staging. O valor nunca deve ser impresso, persistido no
repositório ou incluído em relatórios.

O comando abaixo valida somente o contexto e para antes de qualquer mutação:

```bash
npm run guard:supabase:staging
```

O guard falha fechado quando falta uma variável, há refs divergentes, aparece o
ref de produção em qualquer seletor conhecido, a URL não corresponde ao ref ou
existe link local numa operação mutável. Não existe script de produção e não há
fallback para configuração, URL ou credencial de produção.

## Operações protegidas

O módulo comum classifica como mutáveis: migrations, `db push`, migration
repair, SQL remoto, Functions, secrets, manutenção administrativa e importação
de dados. `scripts/import-studio-clients.mjs` deixou de usar `--linked`: exige
uma database URL explícita e validada como staging.

Qualquer novo script dessas categorias deve chamar o guard antes de abrir
ficheiros de entrada, iniciar rede ou invocar o CLI. Comandos crus do Supabase
não fazem parte do workflow suportado.

## Credenciais

- Não há credencial Supabase em `.env` versionado.
- O incidente anterior prova que uma sessão/credencial local do CLI tinha
  capacidade de produção; a origem exata não é recuperável do histórico do
  shell.
- Uma credencial administrativa ampla nunca é tratada como prova do destino.
  O destino é sempre validado separadamente.
- Para revalidar o ledger remoto, fornecer somente uma credencial de staging
  por canal seguro. Preferência: conexão de uma role temporária read-only com
  `SELECT` apenas em `supabase_migrations.schema_migrations`. Alternativa:
  `SUPABASE_ACCESS_TOKEN` pertencente a uma identidade sem acesso ao projeto de
  produção.

### Role mínima para leitura do ledger

No Dashboard do projeto staging `qflwsdrgdkkcxjnbxmis`, um administrador pode
abrir SQL Editor e, numa futura etapa autorizada, criar uma role exclusiva:

```sql
BEGIN;
CREATE ROLE bellza_staging_ledger_reader
  LOGIN PASSWORD '<password-aleatória-forte>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
ALTER ROLE bellza_staging_ledger_reader SET default_transaction_read_only = on;
ALTER ROLE bellza_staging_ledger_reader SET statement_timeout = '10s';
GRANT CONNECT ON DATABASE postgres TO bellza_staging_ledger_reader;
GRANT USAGE ON SCHEMA supabase_migrations TO bellza_staging_ledger_reader;
GRANT SELECT (version, name)
  ON TABLE supabase_migrations.schema_migrations
  TO bellza_staging_ledger_reader;
COMMIT;
```

Não conceder membership, `CREATE`, acesso a `public`, `auth`, `storage`, outras
tabelas, Functions ou secrets. A conexão deve ser obtida em **Connect** no
Dashboard staging usando essa role; password percent-encoded e ref staging
visível no host direto ou utilizador do pooler. Guardar somente no ambiente
local como `STAGING_DATABASE_URL`, nunca em Git, logs, documento ou chat.

`scripts/supabase-staging-ledger-readonly.mjs` não aceita argumentos nem outro
seletor. Ele executa uma consulta fixa a `version,name` dentro de
`BEGIN TRANSACTION READ ONLY`, envia `PGOPTIONS` com
`default_transaction_read_only=on` e remove tokens/URLs ambientes do processo
filho. A própria role acima constitui a última barreira de menor privilégio.

## Fluxo de produção

Não foi implementado fluxo automático de produção. Uma futura promoção exige
autorização humana explícita, revisão independente do alvo, credenciais
separadas, backup verificado, plano de rollback e comandos apresentados antes
da execução. Este documento não constitui essa autorização.
