# Bellza — correção local Sherlock e Forge

Base: commit `8429588`, worktree isolada `telegram-sherlock-forge-phase25-20261113`. O gateway Windows ativo não foi alterado.

## Causa e mudança

No modo `--tasks`, Sherlock e Forge ainda ofereciam à IA os comandos antigos, diretos, além dos comandos de tarefa. Os metadados locais do gateway ativo mostraram `diagnose_anomaly` e `prepare_investigation`, sem ID de tarefa. O diagnóstico direto não consultava o relatório Cloudflare nem o histórico de incidentes, e falhava quando o ficheiro da execução mais recente faltava. O Atlas também bloqueava Forge antes de este avaliar o diagnóstico se a causa não estivesse comprovada.

Agora, no modo `--tasks`, Sherlock usa `task_investigate` e Forge usa `task_propose`. Sherlock lê o diário do monitor, o relatório atual da Sentinela quando existe, estados HTTP/visual correspondentes à mesma execução e histórico local de incidentes. Um relatório anterior é identificado apenas como histórico. Forge lê o artefacto da tarefa Sherlock referenciada, regista as fontes e bloqueia patch quando a causa não está comprovada. O Atlas conserva IDs, dependências, limites e estados. Os comandos diretos antigos permanecem disponíveis fora de `--tasks`.

## Verificação manual sem Telegram

Na worktree candidata:

```powershell
node --test tests/agents/phase17-telegram.test.mjs tests/agents/phase18-telegram.test.mjs tests/agents/phase23-telegram-tasks.test.mjs tests/agents/phase25-sherlock-forge.test.mjs
node scripts/agents/telegram-sherlock-forge-smoke.mjs "C:\Users\silas\OneDrive\Desktop\charm-book-now-main\charm-book-now-main.worktrees\agents-full-audit-correction-deploy-bellza\public-visual-phase15-20261113\.bellza-agent-state"
```

O segundo comando lê relatórios locais, cria tarefas apenas num diretório temporário e elimina esse diretório. Não acede a tokens, Telegram ou produção. Na execução observada, o diário mais recente apontou `AUTH_UNAVAILABLE`, mas o ficheiro Sentinela dessa execução estava ausente. Sherlock marcou a causa como indeterminada e `OFFICIAL_RECORD_OUTDATED` apenas como histórico; Forge vinculou a tarefa Sherlock e bloqueou patch. Não foram feitas escritas remotas.

## Ativação e reversão futuras

Exige autorização específica. Antes, confirmar commit e worktree limpa, guardar a ação atual da tarefa `Bellza-Telegram-Gateway` e o caminho de reversão, verificar cinco bots e Guardião desligado, e conservar a configuração privada, DPAPI, histórico e alertas. Alterar somente o caminho da ação existente para esta worktree, mantendo os argumentos ativos, incluindo `serve --monitor-events --tasks`. Reiniciar apenas o gateway e confirmar uma instância, cinco bots, tarefas com IDs, alertas e ausência de reenvio de eventos antigos. Em falha crítica, restaurar a ação guardada e reiniciar a versão anterior. Não tocar em `Bellza-Sentinela-Piloto`.

Limite: quando falta o relatório Sentinela atual, o diário e incidentes permitem identificar a anomalia observada, mas não comprovar a causa. Forge não pode preparar patch nesse caso. O teste de linguagem natural usa IA simulada; a escolha pelo modelo real requer validação controlada após futura autorização para atualizar o gateway.
