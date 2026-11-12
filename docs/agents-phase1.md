# Bellza: Atlas e Sentinela (fase 1)

Execução **manual e local**. Esta fase não cria tarefas agendadas, não executa
correções e não altera a aplicação ou dados de qualquer estúdio.

## Comandos

```bash
npm run agents:sentinela
npm run agents:status
npm run test:agents
```

O primeiro comando devolve o estado e o caminho de
`.bellza-agent-state/latest.md`. O Atlas mantém eventos de início e conclusão,
um relatório JSON por execução e o último relatório legível nessa pasta local
ignorada pelo Git. O estado `status` mostra a execução em curso e os últimos
eventos. O código e o manifesto são versionáveis; o histórico local não contém
secrets nem dados pessoais e não é partilhado automaticamente entre máquinas.

## Barreiras

- Só o agente `sentinela` está ativo. As próximas funções são registos
  desativados. O Atlas aceita apenas `run sentinela` e `status`.
- Uma lock atómica impede duas execuções no mesmo checkout. Se o processo for
  interrompido abruptamente, a lock permanece e bloqueia novas execuções até
  inspeção humana; não existe desbloqueio automático.
- Cada execução tem limite de 90 segundos, quatro leituras Cloudflare, duas
  leituras públicas e 128 KiB de saída do processo. Cada resposta Cloudflare
  tem limite de 512 KiB.
- O transporte aceita somente `GET` para deployments, settings, schedules e
  metadados de uma versão UUID do Worker `tanstack-start-app` na conta Bellza.
  Os únicos URLs públicos permitidos são `https://bellza.pt/` e
  `https://bellza.pt/login`. Não envia cookies, não segue redirects e não
  lê páginas de estúdios. A resposta do Worker é reduzida a nomes/tipos de
  bindings, runtime, crons e versão. O relatório é reconstruído pelo Atlas a
  partir de campos permitidos.
- A sessão OAuth local do Wrangler **pode ter permissões de escrita**. O código
  não a trata como credencial de leitura com menor privilégio: a barreira é a
  lista fixa de operações no transporte. Não passar esta sessão a código
  arbitrário ou a futuros agentes sem isolamento adicional. Erros de
  autenticação produzem `INDETERMINADO`. Se o OAuth expirar, a pessoa deve
  renová-lo pelo fluxo oficial interativo do Wrangler; a Sentinela não tenta
  outros tokens nem altera credenciais.
- Supabase, agenda, reservas, Stripe e notificações estão desativados nesta
  fase. Não há leitura SQL, mensagens, pagamentos nem ações sobre clientes.

## Referência e interpretação

`agents/reference.json` regista somente nomes e tipos de 53 bindings,
runtime, crons e a versão observada `9c7bc0a2…` em 12/11/2026. Regista
separadamente a versão ainda presente na branch oficial `cb586b94…`.
Uma versão posterior à observação é marcada `REFERENCE_OUTDATED`; nomes,
tipos, runtime ou crons diferentes são divergências confirmadas *face ao
manifesto*, sujeitas a revisão humana. A Sentinela não presume que uma nova
versão é regressão nem atualiza a referência automaticamente.

Qualquer futura correção, migração, deploy, mudança de permissões ou rollback
requer autorização humana específica. As instruções de `AGENTS.md` continuam
a reger todos os trabalhos Bellza.
