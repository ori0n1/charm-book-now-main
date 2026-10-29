# Base oficial da produção Bellza — 2026-10-29

## Produção ativa — ficha do cliente redesenhada

- Worker `tanstack-start-app`: deployment `edeb7385-9fd8-42c2-8e75-d16c28fff009`, versão `12ba6fcc-acc1-4ef1-9e5b-c2b297e21f35` confirmada por Cloudflare OAuth com 100% do tráfego. Código publicado: commit `08f796376dba14c4145e62c9ae93433bb3bc71b1`.
- Candidato `bellza-client-profile-candidate-20261029.zip`: SHA-256 `F39D60DF4F2DE6ADC5127BD62752BA3D978D6B3AD4AD368B5EBF69E96A25D976`. Rollback compatível após qualquer cliente arquivado: `bellza-client-profile-compatible-rollback-20261029.zip`, SHA-256 `384CB419C4FC4DF3B902C4DCB71516D131A133237F1D4A3682F3ABFC8EC3A7CF`. Configuração de ambos: SHA-256 `23C6AC958B7A05C814B08C4BBCEABF710D45E1069B7EAE7F001E00950670C36B`.
- Cloudflare OAuth confirmou 51 bindings (24 secrets), runtime `2025-09-24` com `nodejs_compat`, cron `*/10 * * * *` e domínios `bellza.pt` e `www.bellza.pt` preservados. A migração Supabase foi aplicada antes do Worker como versão `20261029151943`: coluna `archived_at`, função com permissão de proprietário e dois gatilhos ativos. Zero clientes arquivados na verificação posterior.
- Smoke no estúdio sintético de QA: a lista vazia abriu normalmente; um cliente sintético foi interceptado somente no navegador para conferir a ficha publicada em 390 e 1280 px. Visão geral, histórico, preferências e formulário de edição abriram sem guardar dados; gestor não viu edição nem exclusão. Sem overflow horizontal. Nenhuma exclusão ou anonimização real foi executada.
- Se ninguém tiver sido arquivado, a versão anterior `5496e81c-f0a5-4bfc-8ad6-c6fd2479b124` pode ser reativada com a reversão SQL aprovada. Depois de qualquer arquivo, manter a migração e publicar apenas o ZIP de rollback compatível. As diferenças históricas do Supabase continuam preservadas; não executar `db push` automático.

## Histórico: avisos de repasse Stripe no sino da proprietária

- Worker `tanstack-start-app`: deployment `2cf0d03b-00e8-4e90-9037-0275eeca3baf`, versão `5496e81c-f0a5-4bfc-8ad6-c6fd2479b124` ativa a 100% após o smoke. Fonte publicada: commit `4767bdfa8c833433968558e053a7ddc324f460b1`.
- Artefato aprovado `financial-bell-candidate-v2.zip`: SHA-256 `631957606DCEE7F12316969C928D67A27167B8A5B4C2E5CEE1B4200556C5F0A5`. Rollback exato da versão anterior `e11859e4-08a4-48da-9c21-ffcbe847e59a`: `financial-bell-rollback-active.zip`, SHA-256 `E2CFBBAFB44CB8693A5376A9DEC3616DED10A8759B025B3DEA7CDDA4EACE7D98`. Configuração: SHA-256 `23C6AC958B7A05C814B08C4BBCEABF710D45E1069B7EAE7F001E00950670C36B`.
- Cloudflare OAuth confirmou 51 bindings, incluindo 24 secrets, runtime `2025-09-24` com `nodejs_compat`, cron `*/10 * * * *` e domínios `bellza.pt` e `www.bellza.pt`; três assets críticos foram servidos byte a byte como no ZIP.
- Smoke autenticado em produção com contas de QA e dados financeiros sintéticos no navegador: aviso no sino da proprietária, abertura de Recebimentos > Repasses Stripe pelo ID, 10 repasses apresentados, destaque do ID correto, mensagem para ID fora da lista e seis notificações existentes visíveis. Gestor manteve acesso a Recebimentos e Agenda; profissional manteve Agenda e não abriu Recebimentos.
- Nenhuma migração SQL, cobrança, alteração de pagamentos, saldos ou repasses reais. Nenhum incidente ou rollback. O smoke financeiro usou dados sintéticos; os repasses reais da conta proprietária não foram consultados nem modificados.

## Histórico: produção após Indique e Ganhe Premium v3

- Worker `tanstack-start-app`: deployment `a8019422-ee5f-4b95-9ea1-0195f67d1d11`, versão `e11859e4-08a4-48da-9c21-ffcbe847e59a` ativa a 100% após o smoke test. Código-fonte do candidato: commit `5266185ff549b61ce55968c96cb4116e2245fdca`.
- Candidato `referral-premium-active-v3.zip`: SHA-256 `E2CFBBAFB44CB8693A5376A9DEC3616DED10A8759B025B3DEA7CDDA4EACE7D98`. Rollback compatível `referral-premium-rollback-v3.zip`: SHA-256 `24271D202CC2B05B6DD289107431A5ABB067DBB6F46D1742BEBC71C2E8E4095B`. Configuração comum: SHA-256 `23C6AC958B7A05C814B08C4BBCEABF710D45E1069B7EAE7F001E00950670C36B`.
- Cloudflare OAuth confirmou 51 bindings, incluindo 24 secrets, runtime `2025-09-24` com `nodejs_compat`, cron `*/10 * * * *` e domínios `bellza.pt` e `www.bellza.pt`. A configuração dos ZIPs coincide com a ativa.
- Supabase, somente leitura: migração Premium `20261029110031` aplicada; SQL guardado idêntico ao ficheiro aprovado, funções e objetos efetivos confirmados. Não executar `db push` a partir desta pasta devido às diferenças históricas já registadas.
- Smoke após publicação: inscrição por indicação e confirmação simulada passaram em 1280 e 390 px sem criar conta; FAQ pública renderizada com a regra nova; sete assets críticos servidos byte a byte como no ZIP; rotas administrativas protegidas por autenticação. Duas indicações históricas `legacy_credit` mantêm-se classificadas; não foram executadas cobranças nem atribuições reais de teste.
- O rollback v3 conserva créditos históricos e grants Premium, deixando recompensas Premium novas pendentes. Nunca restaurar o Worker anterior à migração.

## Histórico: produção após ajuste do olho de privacidade

- Worker `tanstack-start-app`: deployment `f4dbe213-72f4-4311-93c6-5c2ee717fc08`, versão `dcf02180-34eb-4b6b-919a-5efc038292a3` ativa a 100%, ETag `23e9d9df615cfdcff4d496e7e9f4c57c990ef297ba184a7c200e56ed6773e39c`.
- Snapshot de código: commit `0c04530`. O diff de produto altera somente quatro arquivos TSX de apresentação do olho de privacidade no Início, Financeiro e Histórico do Caixa. Sem SQL, backend, Stripe, cálculos ou permissões.
- Artefato: 221 módulos do Worker e 526 assets públicos. Preserva byte a byte os 378 assets da versão anterior. Os 18 assets críticos verificados após a publicação coincidem com o pacote. A Cloudflare confirmou o mesmo runtime, 51 bindings, domínios e cron da versão anterior.
- Testes autenticados: proprietário sintético em desktop (1280 px) e mobile (390 px) ocultou e revelou valores nas três páginas com o mesmo PIN; navegação e recarga passaram. O olho cabe no cabeçalho do Início. Gestor e profissional sintéticos continuam sem o controlo. Smoke HTTP passou. Nenhum dado financeiro real foi alterado.
- Rollback imediato: versão anterior `87f2585e-dc96-4af1-8a61-6c646138b8ce` e pacote completo de Worker e assets em `tmp/visual-privacy-implementation/dist` no worktree de controle `agents-full-audit-correction-deploy-bellza`. Não há migração SQL deste ajuste.

## Histórico: produção após privacidade visual

- Worker `tanstack-start-app`: deployment `48bf6d01-fe98-4736-81b5-c52e62e58249`, versão `87f2585e-dc96-4af1-8a61-6c646138b8ce` ativa a 100%, ETag `1a97fd56632cfe8a5d7f4a0198900c428360ee901cb3afaa16d3ca88ac722b0b`.
- Snapshot de código: commit `cf94eaf`. As únicas alterações de produto são os seis ficheiros de apresentação do modo de privacidade visual; não houve mudança de SQL, backend, Stripe ou configuração.
- O Worker publicado foi comparado byte a byte com o artefato: 221 de 221 partes idênticas. Dos 376 assets públicos, 375 coincidem byte a byte; o `robots.txt` inclui um bloco gerido pela Cloudflare. O pacote preserva os 228 assets anteriores.
- Cloudflare OAuth confirmou 51 bindings, incluindo 24 secrets, e os mesmos domínios, cron e runtime. Testes autenticados com proprietário QA passaram em desktop e mobile nas três páginas.
- Rollback: versão `9e09021d-f203-47ca-b0a4-246cc9689171` e o pacote completo de Worker e assets em `release-control/loyalty-management-20261028-candidate/dist`. Não há migração SQL para este recurso.

## Histórico da base anterior

- Worker `tanstack-start-app`: deployment `09cd6d76-1271-4c62-849b-eba4a39a592d`, versão `9e09021d-f203-47ca-b0a4-246cc9689171` com 100% do tráfego, lida pela Cloudflare com OAuth.
- Fonte: `release-control/loyalty-management-20261028-candidate` no worktree anterior. Os 230 módulos baixados do Worker ativo coincidiram byte a byte com `dist/server` desse pacote.
- Foram copiados 437 arquivos de fonte e suporte, todos com SHA-256 igual ao pacote local. Os arquivos de build, temporários e a imagem de smoke ficaram fora desta base.
- O `AGENTS.md` e `.codex/` contêm regras de autonomia de leitura e aprovação de escrita. São instruções locais, não partes do Worker publicado.
- Os assets estáticos foram conferidos em 2026-10-28: 227 de 228 arquivos servidos coincidiram byte a byte. O robots.txt recebido contém um bloco gerenciado pela Cloudflare além do conteúdo do projeto. Antes de publicar, revalide o artefato completo e as configurações efetivas.

Esta base é local e independente do `origin/main` antigo. Crie um worktree separado para cada novo trabalho. Nenhuma alteração de produção foi feita na criação desta referência.

## Verificação complementar de 2026-10-28

Dos 228 arquivos estáticos servidos, 227 coincidiram byte a byte com o build publicado. O robots.txt difere porque a Cloudflare acrescenta um bloco gerenciado antes do conteúdo do projeto. OFFICIAL_BASE.json registra a versão, os bindings e a pendência de autenticação para conferir as migrações SQL de produção. Esta base não é um artefato aprovado para novo deploy enquanto essa pendência não for resolvida.
Três variáveis simples ativas não constam do wrangler.jsonc local; seus nomes estão no manifesto. Os valores efetivos e os 24 bindings secretos devem ser preservados antes de qualquer futuro deploy. Não use a configuração local isoladamente para publicação.

## Verificação das migrações de produção — 2026-10-28

O histórico do projeto Supabase de produção `pwmdzpvnatrvfpgcvnzg` foi lido com a sessão CLI existente, sem executar SQL ou migrações. A última versão aplicada é `20261028143000`. A versão `20261025160000` existe só no histórico remoto. Os arquivos locais `20261026190000`, `20261027160000`, `20261027190000`, `20261027234500` e `20261028010000` ainda não constam do histórico remoto. Essas diferenças estão registradas em `OFFICIAL_BASE.json`; o estado está verificado, mas os arquivos locais pendentes não devem ser aplicados automaticamente. A versão Cloudflare `34be84fa-567e-4271-8cce-622e14b41c0f` continuava ativa com 100% do tráfego na mesma verificação.

## Referência ativa após rollback — 2026-10-28

A versão Cloudflare `9e09021d-f203-47ca-b0a4-246cc9689171` está ativa a 100% e tem o mesmo ETag de script `49189570573745ed961a178381f1943d4138ff65da421a68144f72d5fa7199c0`, runtime e 51 bindings da versão `34be84fa-567e-4271-8cce-622e14b41c0f`. Ela foi enviada do artefato anterior validado para restaurar os assets após a falha do candidato de PIN. A migração SQL `20261028210000` permanece aplicada, sem remoção das tabelas. O recurso de PIN não está no Worker ativo. Esta atualização altera somente metadados da base oficial; o snapshot de código continua o ancestral `4c30d32`.
