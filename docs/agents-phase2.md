# Bellza: Sherlock e Valida (fase 2)

Continuação local do commit `294f267`. Atlas e Sentinela permanecem
operacionais. Nenhuma tarefa recorrente ou acesso de escrita à produção foi
adicionado.

## Execução manual

```bash
npm run agents:sentinela
npm run agents:sherlock
npm run agents:valida
npm run agents:status
npm run test:agents
```

Num checkout novo sem dependências instaladas, executar `npm ci` localmente
antes da Valida; alguns contratos sintéticos usam o compilador TypeScript do
projeto.

O Sherlock lê **apenas o último relatório estruturado da Sentinela** guardado
pelo Atlas no mesmo checkout. Sem esse relatório, devolve
`INDETERMINADO`. Cada anomalia é ligada a verificações observadas, hipóteses
explícitas e áreas possivelmente afetadas. A causa permanece
`NAO_DETERMINADA` quando as evidências não a demonstram. Não consulta
clientes, banco, pagamentos nem serviços externos.

A Valida executa sete ficheiros de teste previamente selecionados, uma vez
cada, que cobrem agenda, clientes, reservas, notificações e pagamentos.
Estes testes usam fixtures e mocks locais; o smoke autenticado de produção
está fora da lista. O processo recebe ambiente sem credenciais de produção,
carrega um guard que recusa chamadas de rede e nunca guarda a saída bruta
dos testes. `APPROVED` significa somente que estes contratos sintéticos
passaram; não comprova paridade de staging ou produção.

O Atlas usa a mesma lock e o mesmo histórico para os três agentes. Uma
execução bloqueia outra no **mesmo checkout**. Sherlock tem limite de 20
segundos; Valida, 150 segundos no total e 15 segundos por ficheiro.
Relatórios ficam em `.bellza-agent-state/latest-sherlock.md` e
`latest-valida.md`, além dos JSONs locais ignorados pelo Git. O comando
`agents:status` mostra os últimos eventos sem dados pessoais.

## Limites conhecidos

- O bloqueio de concorrência é por checkout; uma futura orquestração entre
  worktrees exigirá coordenação partilhada antes de ativar tarefas automáticas.
- A Valida cobre contratos sintéticos selecionados, não fluxos completos
  de navegador, Supabase, Stripe ou entrega real de notificações.
- O Sherlock trabalha com as evidências do relatório; não transforma
  hipótese em causa confirmada nem executa correções.
- A Sentinela continua a reportar indisponibilidade quando o OAuth
  Cloudflare está expirado. Sherlock e Valida não utilizam esse OAuth.

Qualquer correção, migração, deploy, alteração de permissões ou rollback
continua sujeita a autorização humana específica e às regras de
`AGENTS.md`.
