# Bellza: monitorização pública manual (fase 11)

Base local: `b7f75a8`, numa worktree isolada. Este fluxo não altera a tarefa
Windows `Bellza-Sentinela-Piloto` nem participa do seu agendamento.

## Execução

```powershell
node scripts/agents/public-check.mjs
node scripts/agents/public-check.mjs --simulate=studio-failure
node scripts/agents/public-check.mjs --simulate=resource-failure
node scripts/agents/public-check.mjs --simulate=healthy
node --test tests/agents/phase11.test.mjs
```

O código de saída é `0` quando páginas e recursos verificados estão
disponíveis e os testes sintéticos passam, `2` para anomalia ou resultado
indeterminado e `3` para erro local ou execução concorrente. As simulações
não representam a produção. Relatórios e alertas ficam somente em
`.bellza-agent-state/public-live/` ou `public-simulated/`, com espaços
separados, identificador de fluxo e dependências explícitas. A mesma
anomalia gera um alerta `NEW` uma vez; uma leitura incompleta não produz
falsa recuperação. O histórico e os alertas retêm até 240 entradas.

## Cobertura e segurança

A Sentinela faz GET apenas de `/`, `/s/capivarabarbearia` e
`/s/studio27braga` em `https://bellza.pt`. Ela pode fazer HEAD apenas
dos JS/CSS anunciados nessas páginas e com caminho `/assets/` validado.
São no máximo 8 pedidos, 25 segundos no total, 7 segundos por pedido e
128 KB de HTML por página. Não segue redirecionamentos, não envia cookies
ou credenciais e não executa JavaScript, formulários ou ações de reserva.
Não guarda HTML nem valores de resposta; o relatório contém somente
códigos fixos, HTTP, estado dos recursos e gravidade. Sherlock conserva
a causa como não determinada; Forge produz apenas um plano de investigação
não aplicado; Valida executa os sete contratos locais sintéticos; Guardião
não autoriza publicação.

Esta leitura detecta indisponibilidade da página, tipo HTML incorreto,
ausência ou falha HTTP/MIME dos recursos JS/CSS e falta do marcador
público de carregamento da interface. Um HTTP 200, o marcador da página
e os assets acessíveis **não demonstram** hidratação, funcionamento da
agenda, horários disponíveis ou reservas. Erros de JavaScript em runtime,
dados privados e fluxos que exijam login ficam **NÃO VERIFICÁVEIS**.
Capivara e Studio 27 são avaliados separadamente; falhas simultâneas
podem indicar impacto em múltiplos estúdios sem estabelecer a causa.

## Primeira execução real

Em 2026-11-12, o fluxo `1341b9e8-eb61-4229-9540-e4937d7a4460` fez
6 pedidos GET/HEAD. `/`, Capivara e Studio 27 responderam HTTP 200;
JS/CSS selecionados responderam com tipo esperado. Não se observou
anomalia nessa cobertura nem alerta novo. Valida: `APPROVED` para testes
sintéticos; Guardião: `INDETERMINADO`. A interface interativa da agenda
e as reservas permanecem não verificáveis sem uma fonte segura adicional.

Para ativação recorrente seria necessária autorização específica e
revisão da cobertura, limites e contexto da tarefa. Não foi ativada.
