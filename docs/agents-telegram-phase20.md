# Bellza — Fase 20: incidentes e alertas Telegram

## Estado nesta fase

O coordenador de incidentes funciona localmente, mas **não está ativo** no gateway em execução. A tarefa Windows da Sentinela continua na versão anterior. Nenhuma mensagem real é enviada por `agents:incidents:simulate` ou por `alert-test` sem `--send-approved`.

## Fluxo e limites

O adaptador lê somente os relatórios locais do monitor (`monitor-state.json` e relatórios de execução associados). Atlas atribui um ID ao incidente e guarda os estados e dependências de Sentinela, Sherlock, Valida e Forge. Guardião permanece `DISABLED`. Sherlock usa as evidências existentes; uma causa sem prova fica indeterminada. Valida executa no máximo dois testes locais da lista aprovada, com ambiente sintético e rede bloqueada. Forge só prepara proposta não aplicada quando a causa estiver comprovada. Não há chamadas à OpenAI neste fluxo automático.

Um ciclo processa no máximo dois incidentes novos, dura no máximo 60 segundos e prepara/envia no máximo cinco alertas. A leitura futura do gateway ocorre a cada cinco minutos, apenas com a opção explícita `serve --monitor-events` e `alertsEnabled: true` na configuração local. O lock impede ciclos de incidentes simultâneos; o gateway conserva o próprio lock de instância. O histórico local guarda apenas códigos, IDs, estúdio e evidência técnica resumida. Caminhos são convertidos em hash; tokens, dados pessoais e texto bruto das evidências não entram nos incidentes.

Na primeira ativação, o histórico já existente vira base sem envio retroativo. Um incidente tem alertas distintos `NEW`, `CHANGED`, `PERSISTENT` e `RECOVERED`, sem repetição do mesmo evento. Persistência exige outra observação ativa após 30 minutos. Leitura inconclusiva não confirma recuperação. Se o Telegram der uma resposta ambígua, a entrega fica `UNKNOWN` e não é repetida automaticamente, porque a API não oferece chave de idempotência para `sendMessage`.

## Comandos locais

Na worktree desta fase:

```powershell
npm.cmd run agents:incidents:simulate
node --test tests/agents/phase20-telegram-incidents.test.mjs
node scripts/agents/telegram-gateway.mjs alert-test
```

O primeiro comando gera um incidente sintético de HTTP 503 na Capivara, uma observação persistente e a recuperação; imprime prévias e `realMessagesSent: 0`. O último apenas mostra uma prévia fixa no perfil Windows configurado. Nenhum dos comandos altera a tarefa ou envia Telegram.

## Ativação futura, sujeita a autorização específica

1. Confirmar o commit candidato, a conta Windows, a configuração privada, o estado da tarefa e guardar sua ação atual para reversão. Confirmar que só o chat privado do proprietário está configurado e que o bot Sentinela corresponde à identidade esperada.
2. Autorizar separadamente **um** envio de teste. Só então ativar `alertsEnabled: true` na configuração local privada e executar `node scripts/agents/telegram-gateway.mjs alert-test --send-approved`. Confirmar recebimento no chat privado e ausência de duplicação.
3. Autorizar separadamente a atualização da tarefa existente do gateway para executar, nesta worktree aprovada, `node scripts/agents/telegram-gateway.mjs serve --monitor-events`. Não criar outra tarefa nem alterar a tarefa da Sentinela. Confirmar que o monitor de 30 minutos ainda produz os artefactos e que o gateway lê apenas esses artefactos locais.
4. Verificar um ciclo sem alertas antigos, os limites e o histórico. Se houver falha, restaurar a ação anterior do gateway e `alertsEnabled: false`; preservar os históricos para análise.

O gateway depende de um perfil Windows com DPAPI, rede e sessão ativa. A cobertura dos alertas depende dos eventos efetivamente produzidos pela Sentinela: dados não verificados não são tratados como saudáveis. O Guardião e notificações a clientes continuam desativados.

**Custo incremental estimado:** zero chamadas OpenAI por incidente automático; apenas CPU local, até dois testes sintéticos por incidente novo e até cinco `sendMessage` Telegram por ciclo após futura autorização. As conversas já existentes com IA mantêm os limites e custos configurados no gateway.
