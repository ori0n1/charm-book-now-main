# Artefatos imutáveis de replay do staging

Este documento formaliza dois artefatos exclusivos do staging. Eles existem
para reconstruir, em clone local descartável, o ponto de partida observado no
staging e não integram a cadeia operacional de produção.

O manifesto canónico é
`artifacts/bellza-staging-remote/staging-replay-manifest.json`. Os bytes dos
dois SQLs estão congelados e os hashes SHA-256 são validados pelo guard local.

## Classificação

### `20260918180000_public_schema_baseline.sql`

- Classificação: `staging-only-baseline`.
- SHA-256: `b2c152495c591d0eacf2c4cd4f67a1b4905b6006526eeff9c960d04f2781017c`.
- Representa o schema público existente antes das migrations incrementais
  usadas no replay do staging.
- Deve ser a primeira migration somente em um banco local vazio e descartável.
- Não é uma migration normal de produção e nunca deve ser aplicada sobre um
  banco existente.

### `20260919151000_staging_storage_fixture.sql`

- Classificação: `staging-only-synthetic-fixture`.
- SHA-256: `9cd8586d272923bb9158949f4a87ce2e38e85af9efdf1a44d7641bef5411b06c`.
- Contém somente metadados sintéticos de buckets e policies necessários para
  reproduzir o staging. Não copia objetos nem dados reais de clientes.
- Deve entrar depois de `20260919150000` e antes de `20260919152000`, somente
  no replay local descartável.
- Nunca deve ser aplicada em produção.

## Guard local

Os artefatos permanecem fora de `supabase/migrations/`; portanto, o Supabase
CLI executado normalmente na raiz não os inclui em `db push`, `migration up`
ou `db reset`. O comando suportado para verificá-los é somente leitura:

```text
node scripts/verify-staging-replay-artifacts.mjs --verify --context=local-disposable-staging-replay
```

O guard:

1. exige o contexto local explícito e rejeita argumentos adicionais;
2. verifica o manifesto e os hashes congelados;
3. confirma classificação, ordem, ambientes e instruções de replay;
4. falha se as versões staging-only aparecerem em `supabase/migrations/`;
5. não abre rede, não chama Supabase CLI e não executa SQL.

As duas rotas também estão marcadas como `-text` em `.gitattributes`. Isso
desativa normalização/conversão de line endings pelo Git e preserva os bytes
que originam os hashes congelados em qualquer checkout.

O guard não é autorização para acessar staging remoto ou produção.

## Cadeia de replay do staging

Materializar em uma cópia local descartável, nesta ordem:

1. `20260918180000_public_schema_baseline.sql` — artefato staging-only;
2. `20260918190000_stripe_financial_integrity.sql`;
3. `20260919140000_tenant_relationship_integrity.sql`;
4. `20260919141000_guard_global_saas_role.sql`;
5. `20260919142000_guard_booking_service_ids.sql`;
6. `20260919143000_guard_tenant_foreign_keys.sql`;
7. `20260919144000_guard_review_staff_ids.sql`;
8. `20260919145000_preserve_booking_service_history.sql`;
9. `20260919150000_public_catalog_allowlist.sql`;
10. `20260919151000_staging_storage_fixture.sql` — artefato staging-only;
11. `20260919152000_restrict_internal_financial_notification_rpcs.sql`;
12. `20260922120000_security_definer_execute_allowlist.sql`;
13. `20260922130000_private_catalog_invoker_views.sql`;
14. `20260922140000_move_btree_gist_to_extensions.sql`;
15. `20260922150000_revoke_browser_access_to_internal_tables.sql`;
16. `20260922160000_stripe_webhook_processing_lease.sql`;
17. `20260922170000_stripe_webhook_claim_fencing.sql`;
18. `20260923213000_allow_verified_subscription_reactivation.sql`;
19. `20260924120000_revoke_authenticated_maintain_subscriptions.sql`.

Antes de materializar, executar o guard na árvore de origem. O destino deve ser
um novo projeto Supabase local, sem `project-ref`, `linked-project.json`, URL de
banco remoto ou credencial remota. A materialização dos dois artefatos dentro
da pasta de migrations existe somente durante a vida do clone descartável.

## Cadeia futura de produção

Produção nunca consome o baseline nem a fixture acima. Em um banco de produção
existente, a promoção futura parte do schema e ledger já verificados e aplica
somente migrations operacionais novas, na ordem, após revisão e autorização
específicas. `20260923213000` e `20260924120000` são migrations operacionais;
os artefatos `20260918180000` e `20260919151000` não são.

Uma instalação de produção vazia não deve usar este baseline de staging. Ela
exige uma estratégia própria e validada de bootstrap/baseline de produção.
Este repositório não cria nem autoriza esse fluxo automaticamente.

## Imutabilidade

Não editar, normalizar line endings, renomear ou substituir os dois SQLs. Uma
mudança necessária deve gerar novo artefato e novo hash, acompanhados de revisão
e replay completo. Divergência de hash bloqueia o replay.
