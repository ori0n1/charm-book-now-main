# Bellza Fase 23 — tarefas e aprovações locais

Esta versão é candidata. A tarefa Windows `Bellza-Telegram-Gateway` continua a executar a versão anterior. Nenhum bot, alerta ou aprovação da Fase 23 foi ativado.

## Comandos sem Telegram real

No PowerShell da worktree desta fase:

```powershell
npm.cmd run agents:tasks:simulate
node --test tests/agents/phase23-telegram-tasks.test.mjs
npm.cmd run agents:tasks:status
```

`simulate` usa apenas dados sintéticos e elimina o estado temporário. `status` apenas lê os metadados locais, sem aceder a tokens. O histórico da versão candidata ficará em `config.stateDir/tasks/tasks-state.json` quando ativado.

## Fluxo preparado

O Atlas pode listar tarefas e encaminhar monitorização, investigação, validação e proposta. A Sentinela lê relatórios e pode acompanhar um estúdio durante sete dias; a notificação continua a ser feita apenas pelo sistema de incidentes já existente. Sherlock usa evidências do monitor e identifica ficheiros locais relevantes por uma lista fixa, sem atribuir causa a partir dessa associação. Valida executa os sete testes sintéticos existentes após uma aprovação pontual. Forge bloqueia propostas se Sherlock não tiver comprovado a causa. Quando a prova estruturada incluir uma referência de versão verificada, Forge pode pedir aprovação para criar uma worktree separada e nela escrever somente `proposal.patch` e `proposal.json` para `agents/reference.json`; o patch não é aplicado.

Cada tarefa guarda ID UUID, agente, dependência, estado, fontes e códigos de evidência. Não guarda a mensagem recebida, nomes de clientes, tokens ou resposta livre da IA. Os estados são `PENDENTE`, `EM_EXECUCAO`, `AGUARDANDO_APROVACAO`, `CONCLUIDA`, `BLOQUEADA` e `FALHOU`. Uma tarefa encontrada em execução após reinício fica bloqueada para revisão, sem repetição automática. O limite é uma execução ativa, 30 tarefas por dia, 200 tarefas guardadas e 75 segundos por tarefa; o gateway mantém os limites de IA e frequência anteriores. Os testes Valida têm também timeout individual de oito segundos.

Os botões `Aprovar`, `Rejeitar` e `Ver detalhes` usam callbacks do [Telegram Bot API](https://core.telegram.org/bots/api#inlinekeyboardbutton). O gateway verifica utilizador, chat privado e identidade do bot antes de processar o callback. A decisão só pode ser usada uma vez e expira após 15 minutos. O texto do modelo nunca determina uma permissão nem um comando de shell. As aprovações só cobrem os dois atos locais definidos acima; não autorizam produção, staging, publicação, migração, SQL, mensagens a clientes ou pagamentos.

## Ativação futura controlada

Depois de autorização específica, comparar a candidata com o gateway ativo, confirmar que os cinco bots permanecem habilitados e Guardião desativado, guardar a ação da tarefa Windows, encerrar somente o gateway atual, alterar somente a ação dessa tarefa para a worktree candidata e acrescentar `--tasks` ao comando `serve --monitor-events`. Iniciar pela própria tarefa e verificar os cinco bots, alertas, histórico e ausência de processos duplicados. Em caso de falha, restaurar a ação guardada e reiniciar a versão anterior. Não criar outra tarefa nem copiar credenciais DPAPI. Sem `--tasks`, as capacidades novas permanecem desligadas.

A correção de identificação `STUDIO:slug` do commit `976bba2` não faz parte desta base ativa. Uma tentativa anterior de combinar essa correção reenviou alertas históricos porque mudou IDs de eventos. Antes de juntar essa alteração, é preciso preservar a compatibilidade desses IDs e provar que os alertas antigos não serão reenviados.

## Limites atuais

As evidências públicas atuais de Sherlock não confirmam a causa de falhas da aplicação; por isso Forge não cria patch real para esses casos. Valida executa os contratos sintéticos existentes, mas ainda não prova que uma correção específica resolveria um incidente. O acompanhamento de incidentes usa apenas eventos novos do monitor; não altera a frequência da Sentinela. Guardião continua desativado. A transição para execução real por Telegram e qualquer alteração da tarefa Windows exigem autorização separada.
