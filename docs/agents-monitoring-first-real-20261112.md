# Primeira monitorização real — 12/11/2026

Worktree local derivada de `b29c058`. Run ID da verificação final:
`184b953f-a719-45a3-9f39-125de37f8481`.

| Verificação | Observação autorizada |
| --- | --- |
| OAuth Wrangler | Renovado interativamente com `account:read`, `user:read` e `workers_tail:read`; `whoami` válido num processo separado. |
| Worker ativo | `9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8`, 100% do tráfego observado. |
| Bindings | 53 pares nome/tipo; correspondência com o manifesto. Nenhum valor lido ou registado. |
| Runtime | `2025-09-24`, `nodejs_compat`, `standard`; corresponde ao manifesto. |
| Crons | `* * * * *` e `*/10 * * * *`; correspondem ao manifesto. |
| Endpoints | `/` e `/login`: HTTP 200. |
| Estado | `ATENCAO`: a referência oficial registada `cb586b94-06c9-4165-a97f-1d5fbc5bd49a` difere da versão ativa. |

Antes da renovação, o sandbox devolveu `NETWORK_UNAVAILABLE`; fora dele os
endpoints públicos responderam, mas a API Cloudflare devolveu
`AUTH_REJECTED`. O login OAuth restrito a leitura resolveu a autenticação.
Não se concluiu que o código da branch oficial corresponde à versão ativa,
nem se alterou o manifesto ou qualquer ambiente remoto.

O relatório completo e os identificadores estão em
`.bellza-agent-state/runs/184b953f-a719-45a3-9f39-125de37f8481.json` e
`.bellza-agent-state/latest-sentinela.md` nesta worktree. Esses ficheiros
locais são ignorados pelo Git. Próximo passo: investigar a origem da versão
ativa antes de propor reconciliação da referência. Esta observação não
autoriza deploy, rollback, migração ou escrita em produção.

Testes locais dos agentes: `24/24` aprovados.
