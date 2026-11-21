# Etapa 2 — reprodução de segurança em QA descartável

1. Executar `stage2-security-snapshot.readonly.sql` somente no SQL Editor autorizado do projeto ativo. A transação deve informar `effective_role=authenticated`, `role_bypassrls=false`, `role_superuser=false` e `row_security=on`. Guardar o objeto `security_snapshot` num ficheiro local protegido. O SQL termina em `ROLLBACK` e não lê linhas de negócio.
2. Recriar o esquema, funções, grants, triggers e políticas no Supabase local descartável, sem copiar dados nem credenciais reais. Criar contas sintéticas pelo Auth local e autenticar sessões emitidas por ele.
3. Executar `node tests/qa/stage2-security-compare.mjs <ficheiro-do-snapshot>` antes da migração candidata e dos testes de escrita. O comparador exige 21 políticas e compara definições, grants, RLS, estrutura, funções, dependências e versão do PostgreSQL. Qualquer diferença bloqueia os testes como prova de equivalência.
4. Depois da equivalência, aplicar a migração candidata apenas no QA local e executar as operações pela aplicação com os três utilizadores sintéticos. Nunca usar `service_role` para provar autorização.

O snapshot contém definições SQL e metadados de segurança; não o colocar no Git nem em relatórios. A ausência do snapshot impede declarar a reprodução fiel ou validar RLS da Etapa 2.
