# Candidato de correção da agenda

Base confirmada por Cloudflare OAuth em 2026-10-30: Worker `tanstack-start-app`, versão `df81cabe-6416-463d-8551-2ea633f44593`, 100% do tráfego. O código-base corresponde ao commit `7e4c2cee62f14b81aa23c605a10c452e6b88b191`.

## Publicação controlada, somente após autorização específica

1. Reconfirmar versão ativa, bindings, secrets, rotas, cron e artefacto completo. Preservar as variáveis adicionais registadas em `OFFICIAL_BASE.json` sem expor valores.
2. Aplicar `supabase/migrations/20261029230000_agenda_role_parity.sql` e depois `supabase/migrations/20261030010000_agenda_structural_edit.sql`. Ambas recusam definições divergentes; não usar `db push` indiscriminado.
3. Publicar o Worker candidato compilado a partir desta branch e conferir versão e tráfego ativos.
4. Executar smoke dirigido com dados sintéticos, sem recebimentos reais.

## Rollback preparado

1. Reverter o Worker para a versão Cloudflare `df81cabe-6416-463d-8551-2ea633f44593` após autorização específica para a reversão.
2. Executar `supabase/rollback/20261030010000_agenda_structural_edit.sql` e depois `supabase/rollback/20261029230000_agenda_role_parity.sql`, também após autorização específica. Ambos verificam deriva antes de restaurar as definições anteriores. Nenhum rollback altera linhas de marcações.
3. Conferir versão/tráfego do Worker, checksums das funções SQL e contagem de marcações.

O rollback estrutural foi executado no PostgreSQL descartável depois dos testes Worker: restaurou o checksum anterior `d2bb121d5332bf406ac1b158240ee99b`, removeu a rotina auxiliar e manteve as 21 marcações sintéticas. O rollback anterior das 11 funções da migração de papéis já tinha sido validado nesta branch.
