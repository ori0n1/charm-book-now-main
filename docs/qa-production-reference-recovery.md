# Bellza QA A/B — referência ativa e decisão de publicação

Estado em 2026-11-17: **NÃO APTO para publicação imediata**. A origem e as diferenças do código foram resolvidas; falta um rollback que não reexponha QA A e uma verificação da versão candidata carregada na Cloudflare, etapas que exigem autorizações separadas. Nenhuma alteração remota foi realizada.

## Evidência da produção ativa

- O OAuth de leitura da Cloudflare mostrou `tanstack-start-app`, versão `9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8` a 100% do tráfego. O conteúdo obtido por `GET .../content/v2` teve ETag `eaf6e90919f57613d87727521aa0a0027ce50ee52290d4d08acc8bdb8b862403`, igual ao ETag do script nessa versão. SHA-256 do multipart bruto: `444c6263322c5fe22cba16f665e2c74e4588ee0a34865931b49cc513ff1e6002`.
- A cópia bruta, o manifesto de hashes e os assets lidos ficaram em `.bellza-agent-state/production-reference/`, ignorado pelo Git. O script de captura não substitui a cópia existente se o hash mudar.
- O manifesto do Worker aponta para a worktree `.capivara-agenda-fix`. Ela está limpa em `4598a4f2cd422309599a1e37458c8e49b27b861a`; os **229/229 módulos** do `dist/server` dessa worktree são idênticos byte a byte aos módulos recebidos da Cloudflare. O rótulo `7fa43e93` na anotação Cloudflare não é necessário como commit Git para esta prova.
- Os 152 JS referidos pelo manifesto responderam a GET público e igualaram os hashes da origem. Dos 221 ficheiros estáticos consultáveis do build de origem, **220** igualaram o conteúdo público; `robots.txt` contém o texto original precedido por `Cloudflare Managed Content`. O candidato e a origem têm **223/223 ficheiros** em `dist/client` com os mesmos nomes e hashes.

## Diferenças do candidato

- A correção ativa da agenda foi copiada sem alteração de três fontes de `4598a4f`: `src/lib/account-booking-phone.ts`, `src/lib/agenda-access.functions.ts` e `src/routes/_authenticated/admin.agenda.tsx`. A agenda mantém o telefone gravado no carregamento inicial e consulta os telefones de apresentação em lotes limitados, sem alterar consentimento ou dados da reserva.
- Em `src/`, o candidato difere da origem comprovada apenas em cinco ficheiros da proteção QA: `public-booking.functions.ts`, `public-studio.functions.ts`, `qa-public-visibility.ts`, `studio-manifest.$slug.ts` e `sitemap[.]xml.ts`. As 45 rotas do manifesto continuam presentes. No build do Worker, 207 grupos de módulos são iguais após remover somente nomes hash gerados e o import do novo filtro; as cinco diferenças restantes são o manifesto, os dois módulos públicos alterados, o novo módulo QA e o router que o incorpora. Não se identificou diferença de código fora do escopo QA.
- O Worker ativo tem 53 bindings por nome/tipo, runtime `2025-09-24` com `nodejs_compat` e crons `* * * * *` e `*/10 * * * *`. `wrangler.jsonc` mantém os dois crons e `keep_vars: true`, mas declara 23 variáveis simples contra 29 ativas; as seis restantes devem ser preservadas e verificadas por nome/tipo na versão carregada. **Não usar `wrangler.production.jsonc` para publicação:** declara apenas um cron e omite cinco variáveis simples ativas. Nenhum valor de secret foi lido ou guardado.
- `OFFICIAL_BASE.json` continua antigo. Não foi atualizado automaticamente.

## Proteção QA e risco de reversão

`docs/qa-public-catalog-proposal.sql` altera exclusivamente as seis funções `private.catalog_public_*` que alimentam `public_studios`, `public_services`, `public_service_categories`, `public_staff`, `public_staff_services` e `public_upsell_offers`. O SQL exige os hashes das definições observadas em 2026-11-16, falha fechado se houver drift e preserva assinaturas, grants, RLS e estúdios reais. Não foi executado nesta etapa.

**O Worker antigo não é rollback seguro enquanto QA A estiver ativo.** As rotas antigas de sitemap e manifesto consultam `studios` com cliente administrativo, independentemente das seis vistas públicas. Portanto, mesmo após o SQL de catálogo, regressar à versão antiga voltaria a enumerar QA A e a expor o manifesto. QA B continua inativo. O SQL de rollback também recusa a reversão enquanto qualquer QA estiver ativo.

Antes de publicar, aprovar e comprovar uma proteção de contingência para o caso de reversão do Worker antigo, ou uma desativação temporária e controlada de QA A antes dessa reversão. Nenhuma dessas ações está autorizada agora. Uma correção progressiva que mantenha o filtro QA é preferível quando tecnicamente segura, mas não substitui um rollback preparado.

## Sequência proposta, ainda não autorizada

1. Reconfirmar versão ativa, 53 bindings, runtime e dois crons; confirmar os seis hashes SQL. Definir e validar a contingência contra reexposição de QA A.
2. Com autorização específica, aplicar somente o SQL de catálogo. Confirmar por leitura anónima limitada que QA A/B desapareceram das seis vistas e que estúdios reais permanecem. QA B continua inativo.
3. Com autorização específica distinta, carregar uma versão candidata sem tráfego usando a configuração de produção de `wrangler.jsonc`, preservar as variáveis e secrets existentes, e comparar módulos, assets, rotas, **todos os 53 bindings**, runtime e crons com a referência. Interromper diante de qualquer diferença inexplicada.
4. Só depois de nova autorização para o tráfego, publicar o artefacto aprovado; confirmar versão/tráfego efetivos e executar smoke test anónimo: sitemap, páginas e manifestos QA A/B ausentes; seis vistas protegidas; páginas e reservas de estúdios reais preservadas. Uma fase canário ainda serviria o Worker antigo em parte do tráfego e manteria a exposição QA nesse período.
5. Ativar QA B somente em etapa posterior e com autorização própria. Reverter a aplicação antiga somente depois de executar e verificar a proteção de contingência aprovada; nunca reverter automaticamente o SQL enquanto QA A/B estiverem ativos.

## Testes locais

- Build de produção, TypeScript, 13 testes direcionados de QA/agenda/pagamentos/telefone, 17 testes de regressão de clientes/plataforma e cenário sintético mobile/desktop do Studio 27: aprovados.
- `node scripts/qa-verify-production-candidate.mjs`: 229 módulos da origem iguais ao Worker ativo; 223 assets do candidato iguais à origem; 45 rotas iguais; apenas os cinco ficheiros de proteção QA alterados em `src/`.
- Testes sintéticos e hashes não comprovam o comportamento depois de uma migração ou publicação real. Não foram executados SQL de escrita, deploy, push, alteração de tráfego ou ativação de QA B.
