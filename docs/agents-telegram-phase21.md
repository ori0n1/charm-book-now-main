# Bellza — Fase 21: ativação local do gateway

Ativado em 13/11/2026 na tarefa Windows existente `Bellza-Telegram-Gateway`, com código local do commit `34990fa`. A tarefa `Bellza-Sentinela-Piloto` não foi alterada. O gateway mantém Atlas, Sentinela, Sherlock, Valida e Forge; Guardião continua desligado. A ação nova aponta para esta worktree e `telegram-gateway-task.ps1` inicia `serve --monitor-events`.

O chat privado autorizado recebeu uma única mensagem marcada `TESTE SINTÉTICO`; a API Telegram aceitou o envio e o proprietário confirmou a receção. O primeiro ciclo do coordenador inicializou 17 IDs de eventos antigos como base, com zero incidentes e zero alertas pendentes, sem reenviar histórico. A tarefa da Sentinela manteve o intervalo de 30 minutos. A colaboração automática aguardará um incidente **novo**; nenhuma causa real foi declarada comprovada nesta ativação.

Na observação de 13/11/2026 às 15:18 (Portugal continental), a leitura Cloudflare estava `READY`; as 40 páginas HTTP foram consultadas, com anomalias, e a verificação visual estava `INDETERMINADO`. A tarefa registou código 2 porque o estado global foi inconclusivo. O próximo ciclo estava previsto para 15:48. Esses resultados são uma fotografia daquele ciclo, não uma declaração de saúde atual.

## Proteções e limites

O gateway usa as credenciais DPAPI existentes e a configuração privada com ACL exclusiva da conta Windows. Só o bot Sentinela envia alertas ao mesmo ID numérico de utilizador e chat privado. O código não chama shell nem SQL a partir do modelo. Valida só executa até dois testes locais da lista aprovada por incidente, com rede bloqueada. Forge não aplica patches. Guardião está desativado. O coordenador limita dois incidentes novos e cinco alertas por ciclo de até 60 segundos; a leitura local de eventos é tentada a cada cinco minutos. Não há custo OpenAI incremental para a colaboração automática. As conversas mantêm os limites já configurados no gateway.

Alertas repetidos usam IDs de evento e estado de envio local. A primeira ativação não envia eventos anteriores. Uma leitura inconclusiva não é interpretada como recuperação. Se o envio ao Telegram tiver resultado ambíguo, fica `UNKNOWN` para revisão manual, sem repetição automática.

## Reversão local

As cópias anteriores estão em `%LOCALAPPDATA%\Bellza\TelegramGateway\rollback-phase21-20261113\config-before.json` e `gateway-task-before.xml`, com ACL exclusiva da conta Windows. Para parar **imediatamente** os alertas, executar nesta worktree `node scripts/agents/telegram-gateway.mjs stop`; isso não para a tarefa separada da Sentinela. Para restaurar também as conversas anteriores:

1. Confirmar que o processo do gateway saiu e que não há outro poller Telegram.
2. Restaurar **somente a ação** de `Bellza-Telegram-Gateway` para o script `scripts\agents\telegram-gateway-task.ps1` da worktree `telegram-gateway-phase17-20261113`, com o diretório de trabalho dessa worktree. O XML guardado contém a ação exata.
3. Repor `config-before.json` sobre o `config.json` privado, preservando a ACL do proprietário, e iniciar a tarefa existente. Confirmar cinco bots, `alertsEnabled: false` e uma instância única.

Não alterar `Bellza-Sentinela-Piloto` durante a reversão do gateway. O monitor continua independente; um resultado `INDETERMINADO` não significa que a infraestrutura esteja saudável.
