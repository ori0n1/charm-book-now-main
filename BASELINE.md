# Base local da produção Bellza — 2026-10-28

- Worker `tanstack-start-app`: deployment `899c9381-6b2f-48b9-a436-7886b8ea176d`, versão `34be84fa-567e-4271-8cce-622e14b41c0f` com 100% do tráfego, lida pela Cloudflare com OAuth.
- Fonte: `release-control/loyalty-management-20261028-candidate` no worktree anterior. Os 230 módulos baixados do Worker ativo coincidiram byte a byte com `dist/server` desse pacote.
- Foram copiados 437 arquivos de fonte e suporte, todos com SHA-256 igual ao pacote local. Os arquivos de build, temporários e a imagem de smoke ficaram fora desta base.
- O `AGENTS.md` e `.codex/` contêm regras de autonomia de leitura e aprovação de escrita. São instruções locais, não partes do Worker publicado.
- Os assets estáticos do cliente não foram comparados individualmente com a CDN. Antes de qualquer publicação futura, valide o artefato completo e as configurações efetivas contra a produção ativa.

Esta base é local e independente do `origin/main` antigo. Crie um worktree separado para cada novo trabalho. Nenhum push ou alteração de produção foi feito na criação desta referência.
