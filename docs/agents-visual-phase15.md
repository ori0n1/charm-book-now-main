# Bellza — validação operacional do monitor integrado (fase 15)

Base `9446c89`. Worktree isolada `public-visual-phase15-20261113`.
O piloto Windows `Bellza-Sentinela-Piloto` permanece na worktree da fase 12,
com `scripts/agents/monitor.mjs`; nenhuma tarefa foi criada ou alterada.

## Contexto e método

O Agendador usa a conta `silas`, `InteractiveToken` (LogonType 3),
`RunLevel` limitado (0), `IgnoreNew` (MultipleInstances 2) e limite de
três minutos. A sessão de ensaio estava em `SILAS\silas`, sem grupo
Administrators habilitado. `phase15-operational.ps1` iniciou o mesmo
`C:\Program Files\nodejs\node.exe` em janela oculta, sem entrada padrão,
com saída redirecionada e sem variáveis de tokens alternativos. Esta é
uma reprodução local do token interativo e do contexto sem interface; o
lançamento pelo serviço do Agendador não foi testado, pois a tarefa não
podia ser alterada nesta fase.

O script acompanhou por CIM os descendentes do Node a cada cerca de
300 ms, somando working set de todos os processos Node e Chromium vistos.
O pico combinado é simultâneo; os picos individuais podem ocorrer em
momentos diferentes. Após cada execução, esperou dois segundos e verificou
os PIDs Chromium observados. A telemetria fica em
`.bellza-agent-state/phase15-operational/` sem credenciais.

## Resultado real

| Medida | Execução 1 | Execução 2 |
| --- | ---: | ---: |
| Duração total | 64,515 s | 57,122 s |
| Pico Node agregado | 391 516 160 B | 318 881 792 B |
| Pico Chromium agregado | 355 221 504 B | 306 896 896 B |
| Pico simultâneo Node + Chromium | 503 263 232 B | 489 312 256 B |
| Chromium observados ao longo do ciclo | 25 PIDs | 24 PIDs |
| Chromium órfãos após o ciclo | 0 | 0 |
| Pedidos Cloudflare | 4 | 4 |
| Pedidos aos endpoints públicos | 2 | 2 |
| Pedidos HTTP públicos | 57 | 57 |
| Pedidos visuais | 88 | 83 |
| Total de pedidos | 151 | 146 |

Ambos os processos terminaram com código 0, sem timeout. Média total:
60,819 s; máximo: 64,515 s, abaixo de 180 s. A amostragem mede working
set, não um limite rígido de memória configurado no Windows. O monitor
limita uma instância, um Chromium por ciclo, 150 pedidos visuais, cache
de assets de 12 MB e até 60 s da etapa visual dentro do ciclo Atlas.

Cloudflare: OAuth `READY`, versão ativa
`9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8`, 53 bindings; tráfego,
bindings, runtime, settings e crons passaram. `ATENCAO` corresponde à
pendência conhecida `OFFICIAL_RECORD_OUTDATED`, sem alerta novo.

HTTP: 40/40 páginas públicas e recursos verificados em cada execução,
sitemap `OK`. Visual: oito páginas e 12 vistas por ciclo, ciclos rotativos
0 e 1, sem erro confirmado de JavaScript ou recurso na amostra. O estado
`PARCIAL` preserva a indicação de agenda interativa não verificável nos
estúdios sem acesso privado. O Atlas preservou dois IDs de execução nos
históricos de monitor, HTTP e visual; zero alertas duplicados.

Um terceiro ensaio oculto injetou uma exceção local na etapa visual em
estado separado. Terminou em 27,939 s, sem Chromium, com OAuth `READY`,
Cloudflare `ATENCAO`, HTTP 40/40 e visual `INDETERMINADO`/
`VISUAL_CHECK_FAILED`. A falha não interrompeu as leituras anteriores.

## Decisão e próxima ação

**APTO para ativação controlada futura**, dentro do contexto validado e
dos limites observados. Isto não autoriza nem executa a ativação. O
Agendador com `InteractiveToken` depende da sessão Windows da conta;
fechar a sessão Codex não encerra a tarefa, mas terminar a sessão Windows
pode impedir a execução. O working set observado não constitui um limite
de memória imposto pelo sistema; acompanhar as primeiras execuções após
ativação.

Após autorização específica, guardar a configuração atual da tarefa e
preservar as duas árvores de histórico; atualizar somente a ação da tarefa
existente para `scripts/agents/monitor-visual-live.mjs` nesta worktree,
mantendo conta, privilégios, gatilho, `IgnoreNew` e limite de três minutos.
Executar imediatamente pela tarefa e confirmar OAuth, Cloudflare, HTTP,
visual, pedidos, tempo, memória, alertas e ausência de órfãos.

Se alguma verificação falhar, desativar a tarefa, restaurar a ação
anterior `scripts/agents/monitor.mjs` na worktree
`public-monitor-phase12-20261112`, executar e confirmar o monitor antigo.
Preservar os dois históricos para investigação. Nenhuma destas ações foi
realizada nesta fase.
