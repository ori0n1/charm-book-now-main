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

A Sentinela lê por GET o sitemap público e verifica cada rota de estúdio
ou artigo nele anunciada. Acrescenta as páginas gerais e de acesso
publicamente alcançáveis que não estão no sitemap: `/login`, `/signup`,
`/forgot-password` e `/reset-password`. Capivara e Studio 27 também ficam
na lista fixa caso o sitemap esteja indisponível. O resultado informa
sempre páginas descobertas e verificadas; uma falha do sitemap ou um limite
atingido tornam a cobertura **incompleta**, nunca saudável por omissão.

Ela faz HEAD apenas dos JS/CSS anunciados em cada página, incluindo o
módulo próprio da rota, e apenas sob `/assets/`. São no máximo 60 páginas,
90 pedidos e 150 segundos no total, com intervalo mínimo de 200 ms entre
pedidos reais, 7 segundos por pedido e 128 KB de HTML por página. Se o
sitemap crescer além desses limites, o comando reporta cobertura parcial
para revisão antes de aumentar o volume. Não segue redirecionamentos,
não envia cookies ou credenciais e não executa JavaScript, formulários
ou ações de reserva.
Não guarda HTML nem valores de resposta; o relatório contém somente
códigos fixos, HTTP, estado dos recursos e gravidade. Sherlock conserva
a causa como não determinada; Forge produz apenas um plano de investigação
não aplicado; Valida executa os sete contratos locais sintéticos; Guardião
não autoriza publicação.

Esta leitura detecta indisponibilidade da página, tipo HTML incorreto,
ausência ou falha HTTP/MIME dos recursos JS/CSS de cada rota e falta do marcador
público de carregamento da interface. Um HTTP 200, o marcador da página
e os assets acessíveis **não demonstram** hidratação, funcionamento da
agenda, horários disponíveis ou reservas. Erros de JavaScript em runtime,
dados privados e fluxos que exijam login ficam **NÃO VERIFICÁVEIS**.
Cada estúdio é avaliado separadamente; falhas simultâneas podem indicar
impacto em múltiplos estúdios sem estabelecer a causa. Rotas com token
individual, callback de autenticação, recibos e APIs não são páginas
públicas enumeráveis e não são visitadas pelo monitor.

## Primeira execução real

Em 2026-11-12, o fluxo `85210872-da79-4fe2-9b4a-4b2f7eb2706a` leu
o sitemap (36 URLs) e verificou **40/40 páginas**: 27 estúdios anunciados
e 13 rotas gerais/de acesso. Foram 57 pedidos GET/HEAD. Todas as páginas
responderam HTTP 200; os JS/CSS essenciais selecionados responderam
com tipo esperado. Não se observou anomalia nessa cobertura nem alerta
novo. Valida: `APPROVED` para testes sintéticos; Guardião:
`INDETERMINADO`. A interface interativa da agenda e as reservas
permanecem não verificáveis sem uma fonte segura adicional.

Para ativação recorrente seria necessária autorização específica e
revisão da cobertura, limites e contexto da tarefa. Não foi ativada.
