# Bellza — verificação visual e JavaScript manual (fase 13)

Base: commit `0f7c448`, worktree isolada. A tarefa
`Bellza-Sentinela-Piloto` continua a usar a worktree da fase 12. Este
comando visual **não está no agendamento**.

## Comando

```powershell
node scripts/agents/visual-check.mjs
node scripts/agents/visual-check.mjs --simulate=js-error
node scripts/agents/visual-check.mjs --simulate=missing-main
node scripts/agents/visual-check.mjs --simulate=asset-404
node scripts/agents/visual-check.mjs --simulate=offline
node scripts/agents/visual-check.mjs --simulate=mobile-overflow
node --test tests/agents/phase13.test.mjs
```

Os cenários sintéticos usam respostas fornecidas localmente ao Chromium,
sem rede. O comando real usa o sitemap público e a lista fixa da
Sentinela para selecionar oito páginas prioritárias: `/`, `/login`,
`/signup`, `/forgot-password`, `/blog`, `/contacto`, Capivara e Studio 27.
Verifica todas em desktop e quatro em mobile: `/`, `/login`, Capivara e
Studio 27. O relatório informa o total de páginas públicas enumeradas,
as verificadas e as não cobertas por esta amostra.

## Segurança e interpretação

O Chromium usa contexto temporário sem sessão, permissões ou downloads;
service workers ficam bloqueados. Só pode navegar por GET nas oito rotas
selecionadas e ler por GET/HEAD assets públicos de `bellza.pt` sob
`/assets/`. Qualquer POST, API, URL com parâmetros, origem externa ou rota
fora da lista é abortado. Não há submissão de formulários nem cliques em
ações de reserva. Apenas uma página é examinada por vez. Limites: 110
segundos, 350 pedidos remotos permitidos e oito páginas. JS/CSS/fonts
repetidos são reutilizados de cache **somente em memória**, reduzindo
tráfego. Nenhuma captura, texto de página, cookie ou token é gravado.

A Sentinela distingue HTTP de DOM visível, `<h1>`, formulário de login,
links públicos principais, overflow horizontal, falhas de recursos e
exceções JavaScript não tratadas. Relatórios guardam códigos, estado,
contagens e fingerprint de erro, sem mensagem ou stack original. Erros
de rede causados pelos bloqueios da política não são declarados defeitos
da Bellza. Sherlock mantém a causa como não determinada; Forge produz
apenas plano de investigação não aplicado; Valida executa contratos
sintéticos; Guardião não autoriza publicação. Atlas mantém lock, IDs,
histórico e alertas locais sem repetição.

O browser não consulta Supabase, Stripe nem dados privados. Quando a
interface de agenda depende desses pedidos ou de login, o resultado é
**AGENDA_NAO_VERIFICAVEL**. Renderização visível e HTTP 200 não provam
horários, reservas, pagamentos ou entrega de notificações. Capturas são
criadas apenas em memória para confirmar que houve um quadro renderizado;
o verificador não interpreta visualmente os pixels.

## Evidência

Na primeira execução real, 8 de 40 páginas enumeradas foram selecionadas,
com 12 renderizações desktop/mobile. Todas apresentaram `main` visível,
sem exceção JavaScript não tratada nem recurso essencial falhado na
cobertura observada. A agenda dos dois estúdios ficou não verificável nas
quatro vistas. O cache reduziu os pedidos remotos permitidos de 341 para
88. O fluxo real final foi `07ba9a40-fe7b-4f04-98fe-dcdcbe5f9f63`;
zero alertas novos. A fixture `js-error` provocou exceção após HTTP 200 e
foi classificada `VISUAL_JS_UNHANDLED`. Os testes também verificaram DOM
ausente, recurso 404, HTTP 503 e overflow mobile.

Antes de qualquer integração no monitor automático, medir tempo e
volume no contexto da tarefa de 3 minutos, definir amostragem e tratamento
de bloqueios, validar resultados repetidos e pedir autorização específica
para mudar a tarefa. Nenhuma alteração da tarefa foi feita nesta fase.
