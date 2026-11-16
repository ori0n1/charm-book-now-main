# Bellza QA A/B — preparação de publicação (2026-11-16)

**Decisão: NÃO APTO para publicar este candidato.** Nenhuma alteração remota foi feita nesta validação.

## Produção observada

Cloudflare OAuth com escopos de leitura confirmou o Worker `tanstack-start-app`, versão `9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8` a 100% do tráfego, etag `eaf6e90919f57613d87727521aa0a0027ce50ee52290d4d08acc8bdb8b862403`, 53 bindings por nome/tipo sem diferenças do manifesto, runtime `2025-09-24` com `nodejs_compat`, e crons `* * * * *` e `*/10 * * * *`. `/` e `/login` responderam 200. A anotação da versão cita `7fa43e93`, commit ausente deste repositório local. `OFFICIAL_BASE.json` ainda referencia `cb586b94-06c9-4165-a97f-1d5fbc5bd49a`. A correspondência do código e dos assets do candidato com o Worker ativo não está comprovada. Não substituir essa referência automaticamente.

Frente ao ancestral local `68247feb`, a árvore `src/` do candidato só acrescenta a proteção QA nos ficheiros de sitemap, SEO, manifesto, reserva e no novo filtro partilhado; não há diferença local em pagamentos, notificações ou autenticação. Isso **não** comprova ausência de diferenças frente à versão ativa `9c7bc0a2…`, cuja correção anotada não está no Git local. O download de conteúdo do Worker respondeu com etag igual ao da versão ativa, mas não foi comparado módulo a módulo nem com assets de produção.

GETs públicos sem login confirmaram: sitemap 200 com 28 URLs de estúdios e QA A enumerado; página e manifesto QA A 200; página e manifesto QA B 404 enquanto inativo; uma página de estúdio real 200. O QA A já está exposto. Se QA B fosse ativado com a implementação atual, as fontes de catálogo incluiriam o estúdio ativo.

## Escopo protegido

O código candidato exclui os dois IDs QA e os slugs conhecidos do sitemap, SEO/página, manifesto e três entradas de reserva pública. O filtro por ID também protege os dois estúdios se o slug mudar. As seis vistas `public_studios`, `public_services`, `public_service_categories`, `public_staff`, `public_staff_services` e `public_upsell_offers` concedem `SELECT` a `anon`; as seis funções `private.catalog_public_*` são `STABLE SECURITY DEFINER` e usam `studio.is_active = true` sem exclusão QA. A proposta SQL filtra os IDs nessas seis fontes, sem mudar assinatura, grants, RLS ou outros estúdios. As RPCs de cotação e criação pública de reservas verificadas não concedem `EXECUTE` a `anon` ou `authenticated`; os caminhos de servidor continuam protegidos no candidato.

Os fluxos administrativos QA autenticados não recebem o filtro das vistas públicas. O acesso real QA A/QA B e o isolamento RLS ainda carecem de teste autorizado. Não confundir filtro local com prova de isolamento em produção.

## Sequência exigida antes de publicação

1. Recuperar o código/artefacto comprovadamente correspondente à versão ativa `9c7bc0a2…`, ou comparar integralmente o conteúdo do Worker ativo com o artefacto candidato (módulos, assets, rotas, binding names/types, runtime e crons). Incorporar a correção anotada `7fa43e93` e justificar cada diferença fora do filtro QA. Construir um artefacto reproduzível e preparar uma versão anterior segura. Sem isso, não publicar.
2. Após autorização específica de migração, executar **exatamente** `docs/qa-public-catalog-proposal.sql` somente se os seis hashes de preflight ainda coincidirem. O script é idempotente e falha fechado se qualquer função divergir; nenhuma permissão ou RLS é alterada. Confirmar, com leitura anónima limitada, ausência dos dois QA nas seis vistas e presença de estúdios reais. QA B continua inativo.
3. Após autorização específica para o artefacto da aplicação, publicar somente o candidato comparado e aprovado. Reconfirmar os 53 bindings por nome/tipo, runtime, crons, domínios, assets e versão/tráfego; testar sitemap, páginas, manifestos, reservas sem escrita e uma amostra real. Verificar QA A ausente de toda resposta pública. QA B continua inativo.
4. Somente depois de proteção comprovada na aplicação e no catálogo, solicitar autorização separada para alterar apenas `studios.is_active` de QA B. Confirmar os dois QA ausentes publicamente e o acesso administrativo QA autenticado, sem executar reservas, pagamentos ou mensagens reais.

O QA A já está visível hoje. Aplicar a migração antes da aplicação deixa temporariamente sitemap e manifesto QA A públicos; inverter a ordem deixa temporariamente as vistas de catálogo públicas. Para exigir ausência de exposição durante toda a transição, seria necessária autorização separada para desativar QA A temporariamente após rever impacto; não fazer isso por conta própria.

## Reversão

O SQL de reversão exato está em `docs/qa-public-catalog-rollback-proposal.sql`, mas **recusa a execução enquanto qualquer QA estiver ativo**: remover o filtro reexporia QA A/B. Reverter só a aplicação também reintroduziria QA no sitemap e manifesto. Se surgir regressão, manter o filtro de catálogo e preparar correção local que preserve a exclusão QA; qualquer reversão da aplicação ou desativação QA exige autorização específica e verificação de segurança. Não executar rollback automático.

## Validação local

Doze testes locais direcionados passaram: exclusão QA, consistência da migração/reversão, agenda, telefone e pagamentos. O TypeScript e o cenário sintético de controlos conjuntos do Studio 27 também passaram. O primeiro build de desenvolvimento compilou o cliente, mas o SSR falhou ao criar `dist/server/assets` com `EPERM` no sandbox. Uma única repetição fora dessa restrição concluiu cliente e SSR com sucesso. Nenhum build local prova que o artefacto corresponde à versão ativa nem que os filtros já estão publicados.
