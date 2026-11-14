# Leitor Supabase para agenda e reservas

**Estado: bloqueado.** A evidência autorizada anteriormente registou `bellza_catalog_reader` como `NOLOGIN`, `NOBYPASSRLS` e sem memberships, mas com privilégios **efetivos** de escrita herdados de `PUBLIC` em duas tabelas `net`, uma sequência e execução de rotinas `SECURITY DEFINER`. Esses resultados não foram revalidados nesta sessão: esta worktree não dispõe de ligação SQL com role segura. A CLI de projeto não verifica a role e o endpoint `database/query/read-only` usa uma role com `BYPASSRLS`; nenhum dos dois autoriza leitura de agenda ou reservas.

O ficheiro [supabase-reader-review.sql](supabase-reader-review.sql) contém somente consultas de catálogo em `BEGIN READ ONLY` e `ROLLBACK`. Foi preparado para revisão por um administrador no projeto `pwmdzpvnatrvfpgcvnzg`; **não foi executado**. Ele identifica atributos da role, privilégios efetivos e políticas RLS das relações candidatas. A lista de relações é exploratória: migrações locais não comprovam o esquema ativo.

## Permissões mínimas pretendidas

- Uma identidade própria com `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`, zero memberships e zero privilégios efetivos de escrita, incluindo os herdados de `PUBLIC` e `EXECUTE` em rotinas capazes de escrever.
- `CONNECT` somente à base necessária, `USAGE` apenas aos esquemas aprovados e `SELECT` somente em relações ou vistas mínimas da agenda e reservas. Uma vista deve usar o invocador e respeitar RLS; não pode executar lógica com privilégio do dono que a contorne.
- RLS efetiva para cada estúdio, com testes de duas identidades de estúdio distintas que provem isolamento sem expor dados pessoais. Consultas do agente devem devolver apenas IDs técnicos, estados, contagens e horários estritamente necessários.
- TLS com CA e hostname verificados, segredo num gestor autorizado para a mesma conta Windows, sem service role ou token administrativo. Credencial de leitura separada de qualquer credencial de publicação.

## Ação mínima que requer autorização específica

1. Um administrador executa e revê o SQL de catálogo, sem alterar a base, e confirma as relações e políticas reais.
2. Se qualquer privilégio efetivo de escrita persistir, preparar uma alteração de ACL **com análise de impacto sobre a aplicação** ou uma fonte de leitura isolada. Não ativar `LOGIN` nem emitir password enquanto isso não estiver resolvido. Revogar grants de `PUBLIC` sem análise pode quebrar a Bellza.
3. Só após evidência de zero escrita e RLS efetiva, solicitar autorização específica para o SQL exato de permissões/credencial, executar uma verificação TLS e uma consulta mínima por estúdio. A consulta e a credencial ainda não estão autorizadas nesta etapa.

Não existe aqui SQL executável para ativar a role: os nomes finais das relações, grants e impacto de `PUBLIC` precisam ser confirmados antes de redigir uma mudança segura.
