# Bellza: primeira operação integrada

Base local: `14a66d8`. O Atlas executa Sentinela → Sherlock → Forge → Valida
→ Guardião sob uma única lock do checkout e produz um resumo final. Cada
etapa recebe explicitamente os relatórios desta operação; o `flowId`, os
`runId` e as dependências ficam no relatório. Resultados antigos não são
usados pelo comando integrado.

## Comandos manuais

```powershell
npm.cmd run agents:check
npm.cmd run agents:check -- --synthetic
npm.cmd run agents:check -- --synthetic=unknown-cause
npm.cmd run agents:check -- --synthetic=test-failure
npm.cmd run agents:check -- --synthetic=auth-unavailable
npm.cmd run test:agents
```

Sem argumento, a Sentinela faz somente os GETs permitidos à Cloudflare e
aos dois endpoints públicos fixos; a Valida executa os sete testes locais
selecionados. Sherlock, Forge e Guardião operam localmente. O comando sempre
continua pelas cinco etapas, mesmo quando uma retorna `INDETERMINADO` ou
`BLOQUEADO`, para mostrar onde falta evidência. Um parecer não favorável
produz código de saída não zero, mas guarda o relatório.

`--synthetic` usa versões fictícias, transporte em memória e bloqueio de rede.
A Valida executa os mesmos sete contratos locais e sintéticos selecionados
que no modo normal. Em `test-failure`, uma falha controlada é injetada após
executar o contrato, sem alterar qualquer ficheiro. O teste automatizado
`test:agents` verifica a integração e os bloqueios. O único caso que confirma uma causa no
Sherlock é marcado como simulação e exige prova ligada ao relatório da
Sentinela do mesmo fluxo. Relatórios reais mantêm causas não determinadas
quando a evidência não as comprova.

Relatórios ignorados pelo Git: `.bellza-agent-state/flows/<flowId>.md`, JSON
correspondente e `latest-check.md`. O resumo mostra anomalia, causa,
proposta, testes, parecer e próximo passo. `APTO` significa somente que a
**proposta local** pode ser revista por uma pessoa. Não autoriza patch,
publicação, migração, rollback nem escrita remota.

Limites: a lock é por checkout e não coordena outras worktrees; a
disponibilidade Cloudflare depende do OAuth e da rede já autorizados; os
sete testes reais da Valida podem ficar indeterminados se as dependências
locais estiverem ausentes. A simulação não prova paridade com produção,
preservação de todas as funcionalidades nem rollback.
