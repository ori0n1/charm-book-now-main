# Bellza: Forge e Guardião (fase 3)

Base local: commit `54b8526`. Atlas, Sentinela, Sherlock e Valida permanecem
disponíveis. Esta fase altera apenas código dos agentes, scripts manuais,
testes sintéticos e esta documentação. Não toca na aplicação nem em
`AGENTS.md`.

## Comandos manuais

```powershell
node scripts/agents/atlas.mjs run sentinela
node scripts/agents/atlas.mjs run sherlock
node scripts/agents/atlas.mjs run valida
node scripts/agents/atlas.mjs run forge
node scripts/agents/atlas.mjs run guardiao
node scripts/agents/atlas.mjs status
npm.cmd run test:agents
```

O Atlas usa a mesma lock, histórico e limites de tempo/saída para os seis
componentes. Forge e Guardião leem apenas relatórios estruturados guardados
localmente, em processos sem credenciais de produção. Os relatórios são
reconstruídos pelo Atlas antes de persistir. Ficam em
`.bellza-agent-state/latest-forge.md` e `latest-guardiao.md`; o diretório
é ignorado pelo Git.

Forge exige uma causa **confirmada**, uma única anomalia e vínculo entre
Sherlock e a observação da Sentinela. Nesta versão, só existe proposta
estruturada para reconciliação de `agents/reference.json`, e apenas após
comprovar a origem do artefacto ativo. A proposta contém `from`, `to` e
`applied: false`; nenhum patch é aplicado. Os resultados do Sherlock atual
mantêm a causa `NAO_DETERMINADA`, portanto a execução real de Forge deverá
responder `BLOQUEADO` quando houver anomalias sem causa comprovada. O Atlas
regista o encaminhamento a Valida e Guardião, cuja execução continua manual.

Guardião verifica escopo, vínculo das evidências e resultado da Valida. Exige
os sete testes aprovados **depois** da proposta; um relatório anterior não
libera a proposta. Forge e Guardião executam com bloqueio de rede local.
`APTO` significa somente **proposta local apta a revisão humana**. Todos os
pareceres mantêm `publicationAuthorized: false` e `deployAllowed: false`.
Paridade com produção, preservação de todas as funções, configurações,
rollback e autorização específica não são comprovados nesta fase. Não há
comando de deploy ou de alteração de dados.

Sem relatório prévio do Sherlock, Forge devolve `INDETERMINADO`. Sem proposta
e testes válidos, Guardião devolve `INDETERMINADO` ou `BLOQUEADO`. A lock é
local ao checkout; não coordena outras worktrees. Não há execução recorrente,
acesso a Supabase ou Stripe, mensagens, pagamentos ou verificação de dados
reais.
