# Restauração da gestão de duplicados — 10/11/2026

## Causa verificada

O Worker ativo `63eca2cb-5e5c-4315-bff8-6f52afa11e20` foi construído da base oficial sem os controles de duplicados da branch `agent/bugs/clientes-duplicados-seguros-20261107-005100`. A página de Clientes em `bellza.pt` mostra apenas os filtros de mensagens e ordenação. O histórico da Cloudflare não contém uma versão do Worker identificada com a branch de duplicados; portanto, a evidência aponta para uma publicação feita a partir de uma base que omitiu a interface, mas não comprova em qual URL essa interface foi usada antes da substituição.

## Estado do banco de produção, somente leitura

No SQL Editor do projeto `pwmdzpvnatrvfpgcvnzg`, uma transação `BEGIN READ ONLY` com `SET LOCAL ROLE authenticated` e `ROLLBACK` confirmou `current_user=authenticated`, `row_security=on` e `rolbypassrls=false`. O catálogo mostrou:

- `client_dependency_counts`, `remove_clients_for_owner` e `unify_empty_client_for_owner` presentes, `SECURITY DEFINER` e executáveis pela role `authenticated`.
- Tabela `client_removal_audit`, função `resolve_booking_client_identity` e tabela `client_booking_function_backup` presentes.
- As quatro funções de criação de marcações da correção chamam `resolve_booking_client_identity`.
- `resolve_authenticated_studio_client(uuid,text,text)` também existe e pode ser executada pela role `authenticated` com RLS ligado e sem `BYPASSRLS`.

Hashes MD5 das definições ativas: `client_dependency_counts=accb2b4ba0e5b1c77a321121df9b7577`, `remove_clients_for_owner=cd080513f35e3a0dc3a4355671cff8e7`, `unify_empty_client_for_owner=22714cbd783612cfa09c3a7205bc26d8`. A consulta não leu registros de clientes ou da auditoria e não comprova qual ação ocorreu no estúdio Capivara em 09/11, entre 03:00–05:00 ou 15:00–17:00.

## Alcance do candidato

Restaurar a página de Clientes, os wrappers autorizados de remoção e unificação, a resolução de identidade e os filtros de fichas arquivadas da branch anterior sobre a versão ativa. Não reaplicar migrações nem escrever dados reais neste release. Antes de publicar, comparar o artefato completo, manter 53 bindings, 24 secrets, ambos os crons e domínios, executar os testes de contrato e validar Clientes e Central em sessão autenticada. O rollback do Worker deve preservar o esquema e os dados do banco; se houver ações reais após a publicação, não reverter migrações SQL automaticamente.
