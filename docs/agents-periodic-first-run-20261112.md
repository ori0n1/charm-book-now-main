# Primeira execução manual do monitor — 12/11/2026

Worktree isolada derivada de `dc081d1`. A execução de 15:13 UTC ocorreu
depois de expirar o OAuth anterior às 15:12:57 UTC. O comando
`npm.cmd run agents:monitor` renovou a sessão sem navegador, sem token
alternativo e sem escopos de escrita. A nova expiração observada foi
16:13:24 UTC; os escopos continuaram `account:read`, `user:read`,
`workers_tail:read` e `offline_access`. Nenhum valor de credencial foi
impresso ou guardado no repositório.

| Item | Resultado |
| --- | --- |
| Monitor ID | `4f64f6a0-32ad-468f-856a-b1331bcaffbc` |
| Sentinela run ID | `df9573e5-677b-4fec-b3c5-65743da78f49` |
| Worker ativo | `9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8` |
| Bindings | 53 nomes/tipos, correspondentes ao manifesto |
| Runtime e crons | Correspondentes ao manifesto |
| Endpoints | `/` e `/login`: HTTP 200 |
| Estado | `ATENCAO`, apenas pela referência oficial divergente já conhecida |
| Alertas novos | 0; nenhuma notificação externa |

O relatório completo está em `.bellza-agent-state/latest-monitor.md`; o
estado e os identificadores ficam em `.bellza-agent-state/monitor-state.json`
na mesma worktree, ignorados pelo Git. A simulação validou alterações,
duplicados, indisponibilidade, recuperação e concorrência sem rede.

Esta execução comprova renovação não interativa **neste perfil Windows**.
Ainda não comprova que uma futura tarefa agendada executará com o mesmo
perfil e rede. Nenhuma tarefa recorrente foi criada ou ativada.
