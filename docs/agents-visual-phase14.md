# Bellza — preparação do visual automático (fase 14)

Base `a1cb6ea`. A tarefa Windows `Bellza-Sentinela-Piloto` permanece na
worktree da fase 12; nenhum comando novo está agendado.

## Comandos locais

```powershell
node scripts/agents/visual-check.mjs
node scripts/agents/monitor-visual-preview.mjs
node --test tests/agents/phase11.test.mjs tests/agents/phase12.test.mjs
node --test tests/agents/phase13.test.mjs tests/agents/phase14.test.mjs
```

O primeiro comando lê apenas páginas públicas permitidas. O segundo simula
Cloudflare, HTTP e Chromium com fixtures locais. O ponto de entrada
`scripts/agents/monitor-visual-live.mjs` está preparado, mas **não foi
executado nem ligado à tarefa**; requer autorização específica para ativação.

## Sitemap e cobertura

O último relatório da tarefa anterior marcou `SITEMAP_UNAVAILABLE`. Uma
consulta pública subsequente devolveu HTTP 200 e `application/xml`. Isso
confirma recuperação, mas não identifica a causa da falha anterior.

Os verificadores HTTP e visual agora distinguem erro de rede/timeout,
erro HTTP com código, conteúdo/estrutura inválidos e alteração da lista
válida. Guardam apenas caminhos públicos e data da última lista válida.
Se o sitemap falhar, usam essa lista como `FALLBACK_STALE`; sem lista válida,
mantêm `SITEMAP_UNAVAILABLE`/`NO_VALID_BASELINE`. Nenhum destes estados
comprova saúde das páginas não vistas. Um evento local só nasce na segunda
falha consecutiva; falhas seguintes não repetem o alerta; a recuperação
gera um evento. Alteração real na lista válida gera um evento distinto.

O visual seleciona oito páginas por ciclo: `/`, `/login`, Capivara e Studio 27
sempre, mais quatro páginas rotativas. As quatro essenciais são vistas em
desktop e mobile; as rotativas, em desktop. Com a lista atual de 40 páginas,
nove ciclos cobrem todas ao menos uma vez (4 h 30 min se futuramente
agendados a cada 30 minutos). Cada relatório distingue páginas observadas,
não selecionadas e agenda não verificável. O Chromium é único por ciclo;
os contextos desktop/mobile são temporários. Só GET/HEAD para páginas e
recursos públicos permitidos; APIs, POST, formulários e terceiros são
bloqueados. Máximo de 150 pedidos remotos, 110 s no comando manual e 60 s
para a etapa visual preparada dentro do monitor.

## Medição e isolamento

Três execuções reais, sequenciais e de leitura, nos ciclos 0–2:

| Medida | Resultados | Média | Máximo |
| --- | --- | ---: | ---: |
| Duração visual | 27,054 / 24,431 / 23,557 s | 25,014 s | 27,054 s |
| Pedidos permitidos | 88 / 83 / 81 | 84 | 88 |
| Pico RSS do processo Node | até 198 811 648 bytes | — | 198 811 648 bytes |

Foram observadas 12 renderizações por ciclo e zero anomalias confirmadas
nessa cobertura. A memória indicada é apenas do processo Node; os processos
do Chromium não estão incluídos nessa medida. A agenda interativa de
Capivara e Studio 27 continua não verificável sem pedidos privados. A
simulação integrada concluiu Cloudflare sintética, HTTP sintético e 12
renderizações visuais; a execução integrada real no contexto da tarefa
Windows ainda não foi medida.

O Atlas mantém o lock do monitor durante as três etapas. Uma falha ou
timeout visual produz estado indeterminado sem apagar os resultados
Cloudflare/HTTP. O código existente da tarefa chama `monitor.mjs`, onde
`includeVisual` continua desativado por padrão. Histórico e alertas visuais
ficam num estado local separado; a retenção guarda 60 execuções e remove
somente relatórios antigos identificados, sem tocar no histórico HTTP ou
Cloudflare. Nenhuma captura, HTML, cookie, token ou mensagem de erro livre
é persistida.

## Ativação futura e reversão

**Estado técnico: APTO para integração controlada; não ativado.** Antes de
autorizar a troca da tarefa, confirmar que a worktree candidata está limpa,
medir uma execução integrada real no mesmo contexto Windows com limite
externo de três minutos, verificar o consumo total do Chromium, e guardar
a configuração exata da tarefa e os estados locais. A ativação exigirá
autorização específica para apontar a tarefa existente ao ponto de entrada
preparado, sem criar segunda tarefa. A primeira execução deverá comprovar
Cloudflare, HTTP, visual, alertas e ausência de concorrência.

Se falhar, desativar a tarefa, restaurar a ação anterior que aponta à
worktree `public-monitor-phase12-20261112`, executar e confirmar o monitor
anterior e preservar ambos os históricos para investigação. Não apagar nem
substituir dados da tarefa sem validação. Nenhuma dessas ações foi realizada
nesta fase.
