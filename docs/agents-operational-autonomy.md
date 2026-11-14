# Bellza — preparação local da autonomia operacional

Base dos agentes: `335488d`. Esta worktree não é usada por nenhuma tarefa Windows. O gateway e a Sentinela ativos não foram alterados.

## Acessos comprovados

- Cloudflare: o OAuth do monitor só aceita `account:read`, `user:read`, `workers_tail:read` e `offline_access`; as chamadas do transporte são GET para quatro caminhos fixos. O diagnóstico local `node scripts/agents/access-status.mjs` lê apenas metadados de validade OAuth e o último relatório, sem pedir token, renovar sessão ou consultar a rede. `OPERACIONAL_RECENTE` atesta uma leitura recente, não garante a próxima. A credencial de publicação nunca é carregada pelo monitor.
- Supabase: acesso SQL de produção permanece bloqueado. O guia anterior registou a role `bellza_catalog_reader` como `NOLOGIN` e privilégios efetivos de escrita herdados de `PUBLIC`. Não usar service role, `database/query/read-only` com BYPASSRLS nem o vault de outro perfil. Falta uma role efetivamente sem escrita e com RLS por estúdio, TLS validado e acesso legítimo neste perfil; qualquer mudança de permissões ou credenciais exige autorização própria.
- Stripe e outras fontes privadas: sem leitor comprovadamente limitado a leitura; integração automática desativada. Staging só poderá ser usado após comprovar isolamento, dados sintéticos e ausência de notificações/cobranças reais.

Nos 47 relatórios locais consultados em 14/11/2026 não apareceu código de falha de acesso Cloudflare; o último registo de leitura bem-sucedida tinha apenas `OFFICIAL_RECORD_OUTDATED`. A causa de falhas intermitentes anteriores **não está comprovada**. O código candidato agora distingue renovação OAuth não concluída, validade insuficiente, verificação OAuth falhada, HTTP 429, HTTP 404, erro de API 5xx e falha de rede. Um 404 pede revisão da rota; não prova alteração de configuração. Um erro do monitor não prova falha da aplicação.

## Fluxo que já funciona e limite atual

A Sentinela mantém o monitor agendado existente. O gateway já processa eventos novos: Atlas atribui um incidente, Sherlock analisa a evidência da mesma execução, Valida escolhe no máximo dois casos locais relevantes, Forge só apresenta proposta com causa comprovada; alertas e incidentes repetidos são suprimidos. Um pedido ao Atlas cria tarefa principal, dependências e resumo com detalhes sob pedido. Aprovações para testes locais valem 15 minutos e são de uso único.

Uma correção de código da aplicação **não pode ser inventada** a partir de HTTP 200, um código de alerta ou uma hipótese. A única preparação de patch implementada anteriormente limita-se à referência local de versão, com prova da origem, worktree isolada e aprovação específica. Sem diagnóstico causal e correspondência com código ativo, Forge permanece bloqueado. Guardião está desativado; o gate `reviewReleaseEvidence` somente compara provas locais e nunca autoriza publicação.

## Publicação controlada futura

1. Comprovar versão ativa e origem do código, comparar artefacto completo, bindings por nome/tipo, runtime, crons e funcionalidades protegidas. Preparar patch mínimo em worktree própria; Valida executa testes direcionados e staging apenas se seguro.
2. Guardião, quando configurado e autorizado separadamente, revê escopo, regressões, permissões, artefacto e rollback validado. O gate local pode então indicar `PRONTO_PARA_REVISAO_HUMANA`; todos os campos de autorização de publicação continuam falsos.
3. Pedir autorização humana específica para o artefacto e para um canário. Só um operador separado, com credencial de publicação nunca acessível ao monitor, poderá realizar a escrita autorizada.
4. Confirmar versão/tráfego ativos e testes pós-canário. Pedir **segunda autorização específica** antes de 100% do tráfego. Diante de falha, parar; rollback só com validação técnica e autorização específica.

Nenhum comando de deploy, canário, promoção ou rollback faz parte desta worktree.

## Verificação local

```powershell
node scripts/agents/access-status.mjs
node --test tests/agents/operational-access.test.mjs tests/agents/release-readiness.test.mjs
```

Os testes são sintéticos. A nova classificação Cloudflare só entrará no monitor automático após atualização local autorizada separadamente. O gateway ativo também permanece na versão anterior.
