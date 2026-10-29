# Ficha do cliente — candidato e rollback

Base anterior confirmada por Cloudflare OAuth em 2026-10-29: Worker `tanstack-start-app`, versão `5496e81c-f0a5-4bfc-8ad6-c6fd2479b124` com 100% do tráfego. Fonte anterior `e942d5fcf80edbdc60cf458ab42a0d18798d26e2`. O candidato do commit `08f796376dba14c4145e62c9ae93433bb3bc71b1` foi publicado após autorização do proprietário.

## Publicação confirmada

- Migração Supabase aplicada primeiro, como versão `20261029151943`; coluna, função e dois gatilhos confirmados por consulta somente de leitura. Zero clientes arquivados após a validação.
- Cloudflare OAuth confirmou deployment `edeb7385-9fd8-42c2-8e75-d16c28fff009`, versão `12ba6fcc-acc1-4ef1-9e5b-c2b297e21f35` com 100% do tráfego, 51 bindings e configuração efetiva preservados.
- Smoke no estúdio sintético de QA: a lista vazia abriu; uma resposta de cliente sintético foi interceptada apenas no navegador para validar a ficha publicada a 390 e 1280 px. Separadores, histórico e formulário de edição abriram sem guardar; o gestor não viu ações de edição nem exclusão. Nenhum cliente real foi alterado.

## Escopo

- `src/routes/_authenticated/admin.clientes.tsx`: aparência da ficha, separadores e ocultação de perfis arquivados na lista.
- `src/lib/client-profile-core.ts` e `client-profile.functions.ts`: confirmação e verificação de proprietário antes da função SQL.
- `supabase/migrations/20261029150000_archive_client_owner_only.sql`: anonimização lógica, bloqueio de conta ligada ou marcação futura, proteção contra DELETE direto e contra reidentificação.
- Nenhuma alteração a `wrangler.jsonc`, bindings, Stripe, pagamentos, agenda, notificações ou regras de cálculo.

## Verificações concluídas

- `npm run typecheck` e `node --test tests/client-profile-archive.test.mjs`.
- Migração e casos de permissão, isolamento, bloqueios e integridade histórica executados numa base PostgreSQL local temporária por `tests/sql/client-profile-archive.synthetic.sql`. A base foi removida.
- Pré-visualização do componente real com cliente sintético: 390 px e 1280 px, sem overflow; separadores, edição e confirmação; opção ausente para gestor. A rota temporária de teste foi removida. Capturas locais na pasta de visualizações desta tarefa.
- Teste sintético da reversão SQL antes de qualquer exclusão passou em base PostgreSQL local temporária; a base foi removida.
- Build do candidato e do rollback compatível concluídos com as variáveis públicas efetivas da produção. A configuração de upload local, preparada por OAuth somente de leitura em ambos, tem SHA-256 `23c6ac958b7a05c814b08c4bbceabf710d45e1069b7eae7f001e00950670c36b` e preserva os 51 bindings (27 públicos, 24 secrets), cron, domínios e runtime.
- Comparação com o ZIP da versão ativa (`631957606dcee7f12316969c928d67a27167b8a5b4c2e5cee1b4200556c5f0a5`): os 52 arquivos estáticos fora de `assets/` são idênticos; no `wrangler.json`, apenas os caminhos locais `configPath` e `userConfigPath` diferem. Os chunks gerados têm nomes hash diferentes e o escopo de fonte foi conferido separadamente.

## Artefatos locais

- Candidato: `bellza-client-profile-candidate-20261029.zip`, SHA-256 `f39d60df4f2de6adc5127bd62752ba3d978d6b3ad4ad368b5ebf69e96a25d976`, 466 arquivos.
- Rollback compatível: `bellza-client-profile-compatible-rollback-20261029.zip`, SHA-256 `384cb419c4fc4df3b902c4dcb71516d131a133237f1d4a3682f3abfc8ec3a7cf`, 457 arquivos.
- Ambos estão em `C:\Users\silas\.codex\visualizations\2026\10\29\01a18809-caed-7d62-96b3-4c5d99f52dde`.

## Portas de publicação

1. Reconfirmar por OAuth a versão ativa; se diferir da base acima, reconstruir o candidato a partir da nova base oficial.
2. Aprovar especificamente a migração de produção e o artefato completo. Aplicar a migração antes do Worker: a consulta do candidato usa `archived_at`.
3. Repetir imediatamente antes da publicação a comparação do build completo com a versão ativa: módulos, assets, rotas, runtime, cron, domínio e 51 bindings, incluindo 24 secrets e as variáveis adicionais do manifesto oficial. Preservar os valores efetivos sem os ler ou imprimir.
4. Confirmar estado das migrações e rollback antes da publicação. Não fazer `db push` automático por causa das diferenças históricas registadas em `OFFICIAL_BASE.json`.
5. Após aprovação e publicação, verificar versão/tráfego por OAuth e fazer smoke de abertura, edição, histórico e permissões com dados sintéticos. Não executar exclusão real durante o smoke.

## Rollback

- **Antes de qualquer cliente arquivado:** reativar a versão Cloudflare `5496e81c-f0a5-4bfc-8ad6-c6fd2479b124` após aprovação específica. A migração pode ser revertida por `supabase/rollback/20261029150000_archive_client_owner_only.sql`, que recusa executar se existir qualquer perfil arquivado.
- **Depois de arquivar um cliente:** manter a migração e publicar, após aprovação específica, um Worker de rollback compatível. Construir a partir do commit oficial `e942d5fcf80edbdc60cf458ab42a0d18798d26e2` com **apenas** `CLIENT_PROFILE_COMPATIBLE_ROLLBACK.patch`, que oculta perfis arquivados da lista. Comparar o artefato completo e os bindings antes de o usar. Nunca restaurar dados pessoais anonimizados nem executar a reversão SQL neste cenário.
