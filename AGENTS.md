# AGENTS.md

## Playwright

Este projeto usa Playwright com TypeScript e testes na pasta `tests/`.

Comandos principais:

```bash
npm run test:e2e
```

Executa todos os testes end-to-end configurados.

```bash
npm run test:e2e:chromium
```

Executa apenas no Chromium. Use este comando para uma verificação rápida local.

```bash
npm run test:e2e:ui
```

Abre o modo interativo do Playwright.

Para instalar ou atualizar navegadores e dependências:

```bash
npx playwright install --with-deps
```

A configuração está em `playwright.config.ts`. O Playwright sobe o app automaticamente com `npm run dev -- --host 127.0.0.1 --port 4178` e usa `http://127.0.0.1:4178` como `baseURL`.

Nota para Windows PowerShell: se `npm` for bloqueado pela política de execução de scripts, use `npm.cmd` no lugar de `npm`, por exemplo:

```bash
npm.cmd run test:e2e:chromium
```

## Execução autônoma e segura

- Resolva autonomamente problemas técnicos solucionáveis e investigue alternativas seguras antes de interromper. Não peça autorização para ações locais, reversíveis e dentro do escopo. Evite ciclos de análise sem progresso.
- Preserve a versão ativa em produção e todos os dados reais. Nunca misture alterações locais pendentes com uma publicação cirúrgica: prepare um artefato ou checkout isolado e comprove exatamente quais arquivos mudaram.
- Antes de publicar, compare o artefato com a versão ativa e confira configurações efetivas, bindings, secrets, rotas e triggers. Nunca desative proteções de segurança para conseguir publicar.
- Nunca execute cobranças reais nem modifique dados de clientes durante testes. Use dados sintéticos e ambientes isolados.
- Faça testes direcionados e proporcionais ao risco; reaproveite verificações ainda válidas e não repita testes sem motivo técnico. Valide antes de publicar e prepare um rollback comprovadamente seguro.
- Publique somente após aprovação explícita do proprietário para a ação específica e quando todas as condições de segurança estiverem comprovadas. Faça um smoke test imediato após publicar e reverta regressões somente após aprovação explícita e quando o rollback for comprovadamente seguro.
- Evite auditorias gerais para tarefas localizadas, refatorações fora do escopo e mudanças desnecessárias. Prefira correções pequenas, rápidas e verificáveis.
- Não encerre no primeiro bloqueio técnico. Interrompa apenas diante de riscos não resolvidos, falta de acesso indispensável ou autorização específica necessária. Nunca invente resultados de testes nem declare uma publicação sem confirmação.

## Regra obrigatória — autenticação Cloudflare

1. Sempre que precisar acessar a Cloudflare, consultar o Worker, verificar versões, configurações, bindings, realizar deploy ou preparar rollback, priorize a autenticação via OAuth/login interativo já disponível no ambiente.
2. Não considere uma falha de token como impedimento definitivo sem antes tentar o fluxo OAuth autorizado.
3. Se a sessão estiver expirada, tente renová-la pelo fluxo interativo e solicite minha intervenção somente quando for necessária.
4. Não solicite novos tokens de API enquanto houver uma alternativa OAuth funcional e autorizada.
5. Nunca exponha, registre ou altere credenciais e secrets desnecessariamente.
6. Antes de publicar, continue verificando a versão ativa, preservando os bindings, isolando as alterações e garantindo rollback seguro.
7. Se o OAuth não estiver disponível ou falhar, informe o impedimento real. Nunca ignore as verificações de segurança para forçar uma publicação.

## Base oficial para novos agentes

- A versão ativa em produção, confirmada pela Cloudflare via OAuth, define a base oficial. Comprove a correspondência do código-fonte local ou no GitHub antes de registrar o commit de base.
- Cada novo agente deve criar um worktree isolado e limpo a partir desse commit comprovado. Preserve branches, worktrees e alterações anteriores como referências separadas; não os use como ponto de partida por conveniência.
- Se a correspondência ainda não estiver comprovada, registre o bloqueio e aguarde a identificação da base oficial antes de iniciar novos trabalhos.
- Referência local confirmada em 2026-10-29: repositório `bellza-base-34be84fa`, branch `production-34be84fa`, para a versão Cloudflare `dcf02180-34eb-4b6b-919a-5efc038292a3`. Leia `BASELINE.md` nessa base e reconfirme a versão ativa antes de iniciar trabalho novo, pois a produção pode mudar.
- No repositório principal, a mesma referência está em `official/bellza-production-34be84fa`. O snapshot de código correspondente à produção é o commit ancestral `0c04530`; commits posteriores nesta branch podem acrescentar somente regras e metadados de organização.

## Autonomia de leitura e controle de escrita — Bellza

- Execute leituras necessárias ao pedido sem pedir aprovações repetitivas quando o sandbox e as ferramentas permitirem: arquivos locais do projeto, Git e GitHub, documentação, configurações e metadados da Cloudflare, logs, Workers, versões, bindings e diagnósticos sem alteração de dados.
- Consulte o Supabase apenas por caminhos de leitura autorizados, com a role adequada e RLS efetiva. SQL de diagnóstico deve ser somente leitura; não use uma credencial privilegiada que contorne RLS para justificar uma consulta automática.
- Use configurações oficiais de sandbox e regras estreitas de aprovação. Mantenha o acesso de rede restrito e as raízes graváveis no mínimo necessário; não use acesso irrestrito nem desative proteções para evitar solicitações.
- Priorize Cloudflare OAuth interativo e reutilize a sessão válida. Se surgir uma confirmação humana, indique exatamente a janela e a ação necessária e aguarde; não contorne validações de URL, janelas de segurança ou controles de autenticação.
- Peça aprovação explícita para cada publicação ou reversão em produção, migração no banco de produção, alteração de dados reais, configuração de produção, permissões, políticas RLS, credenciais, operação destrutiva ou concessão de acesso e privilégios. Autorização de leitura nunca autoriza escrita.

## Sincronização permanente da base oficial

1. Confirme por Cloudflare OAuth a versão ativa e parta da referência oficial que corresponde a ela. Use `scripts/new-isolated-worktree.ps1` para criar branch e worktree exclusivos; ele recusa referência local/remota ou versão ativa divergente. Nunca reutilize worktrees antigos como base.
2. Desenvolva somente no worktree novo, com testes direcionados proporcionais ao risco e rollback preparado. Candidatos permanecem em branches próprias.
3. Antes de qualquer publicação, compare o artefato completo aprovado com a versão ativa, incluindo módulos do Worker, assets estáticos, rotas, crons, runtime, variáveis e nomes/tipos dos bindings. Preserve secrets sem ler ou alterar seus valores. O `wrangler.jsonc` desta base não declara seis variáveis ativas adicionais registradas em `OFFICIAL_BASE.json`; preserve seus valores efetivos no artefato aprovado, sem expô-los. Confirme o estado das migrações necessárias e a segurança do rollback.
4. Solicite autorização explícita do proprietário para a publicação específica. Registre no GitHub o candidato aprovado em sua branch, sem antecipar a referência oficial.
5. Publique exatamente o artefato aprovado. Confirme imediatamente por Cloudflare OAuth a versão e o tráfego efetivamente ativos, execute o smoke test direcionado e registre o resultado.
6. Somente após comprovar publicação bem-sucedida, atualize a branch oficial no GitHub e a base local de referência. Registre commit, versão Cloudflare, hash/manifesto do artefato e configurações relevantes. Produção ativa, GitHub oficial e base local devem representar a mesma versão validada.
7. Se a publicação falhar, restaure apenas a última versão segura com rollback comprovado e aprovação explícita, preservando dados e configurações. Registre o estado efetivamente ativo; não promova o candidato rejeitado nem permita que novos agentes partam dele.
8. Se uma migração de banco não permitir rollback seguro, interrompa antes de modificar produção e solicite decisão. Nunca faça reset, sobrescreva ou apague dados reais.

Áreas futuras de trabalho isolado: bugs, Stripe/financeiro, testes, Cloudflare/deploy, desempenho, UX/mobile e marketing/anúncios. Esta lista não autoriza instalar agentes, skills ou MCPs nem executar trabalhos funcionais.
