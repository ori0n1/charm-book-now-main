# Base local da produção Bellza — 2026-10-28

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
