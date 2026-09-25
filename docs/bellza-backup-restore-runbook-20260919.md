# Bellza — ensaio local de backup e recuperação (19/09/2026)

**Escopo:** somente Supabase local descartável `artifacts/stripe-staging-local`, baseado em estrutura sem dados pessoais de produção. Nenhuma ação no Supabase/Stripe de produção. O backup local em formato custom **não é cifrado**; contém estrutura e um marcador sintético, está numa pasta ignorada pelo Git e não deve receber dados reais.

## Evidência executada

1. PostgreSQL local iniciado sem outros serviços porque o Storage local falhou no health check nessa execução. `auth.users=0` antes do ensaio.
2. Criados `restore_probe.evidence` e a linha `synthetic-staging-restore-20260919`; `pg_dump -Fc` completo de `postgres` gerou dump de 1.205.465 bytes, SHA-256 `A924711E0E661A779AE4A928CDDE05596B3F8449479A2DEA11CC277DE887CFB4` em `artifacts/stripe-staging-local/bellza-local-full-20260919.dump`. A captura foi feita **antes** da migration candidata `20260919150000`; ela é um ponto de recuperação dessa mudança, não uma cópia do estado local mais recente.
3. Criado banco local separado `bellza_restore_probe` a partir de `template0`. Restore com papel `postgres` falhou por não poder assumir `supabase_admin`; restore como `supabase_admin` falhou numa ACL do wrapper GraphQL que a extensão não recriou automaticamente. Estes erros foram investigados, não ignorados.
4. Restore como `supabase_admin` a partir da mesma cópia, com TOC filtrado para excluir **somente** a ACL `graphql_public.graphql(...)`, terminou com código 0. O wrapper, ausente no destino, foi reconstruído a partir de `pg_get_functiondef` da origem local, e os quatro GRANTs originais foram reaplicados.
5. Origem e destino: marcador sintético igual; 59 tabelas `public`, 102 policies `public`, 312 funções `public`, 127 triggers `public`, 59 tabelas `public` com RLS ativo, 0 utilizadores Auth, 0 objetos Storage. Checksums normalizados de policies, constraints, triggers e ACLs efetivas de relações/funções em `public`, `auth` e `storage` coincidiram. `graphql_public.graphql(query := '{ __typename }')` retornou `Query` em ambos. O PostgreSQL local foi desligado após o ensaio.

**Classificação:** **PASSOU (local)** recuperação de estrutura, permissões e dados sintéticos com reparo documentado da extensão. **NÃO TESTADO** restauração de projeto Supabase remoto, objetos binários Storage, secrets, configurações Auth/OAuth, Edge Functions, Worker, Stripe, volumetria real e RPO/RTO. O checksum do dump por si só não comprova recuperabilidade.

## Procedimento para staging remoto

1. Confirmar por referência inequívoca que origem e destino são **staging**, nunca `pwmdzpvnatrvfpgcvnzg` (produção). Inventariar versão PostgreSQL/extensões, migrations, buckets, policies, Auth e configuração de aplicação. Desligar escritas da aplicação de staging durante a captura.
2. Obter backup de banco incluindo `auth`, `public`, `storage` e demais schemas do projeto, com proprietários, grants e migrations; exportar objetos Storage separadamente, pois metadados SQL não recuperam ficheiros binários. Guardar credenciais e configurações de Auth/Worker separadamente. Cifrar os arquivos em repouso, controlar acesso e registrar hash SHA-256.
3. Restaurar **num projeto novo isolado**, nunca sobre o projeto de origem. Usar papel administrativo apropriado; tratar explicitamente extensões Supabase/GraphQL e não silenciar erros do `pg_restore`. Reaplicar ACLs faltantes e confirmar privilégios efetivos.
4. Comparar tabelas, contagens, hashes de objetos sintéticos, constraints, policies, triggers, grants, RLS, funções `SECURITY DEFINER`, buckets e objetos. Repetir smoke HTTP Auth/REST/Storage e testes A/B com utilizadores sintéticos. Medir tempo efetivo de recuperação (RTO) e intervalo máximo de dados perdidos (RPO).
5. Se qualquer validação falhar, manter o staging original sem alterar e investigar. Não apontar aplicação/Stripe para o destino até a verificação completa.

## Plano futuro de rollback de produção — ainda não autorizado

Antes de uma janela, congelar migrations concorrentes e capturar backup verificável com restore isolado, além de confirmar PITR/retention efetivos do plano. Aplicar migrations individualmente com inventário pré/pós e smoke de Auth, reservas, RLS e pagamentos. Em incidente, bloquear escritas financeiras e de relações tenant enquanto se avalia o estado; preferir correção adiante. Se for necessária reversão de banco, restaurar para **novo destino isolado** no ponto validado, verificar integridade e só então planejar a troca de tráfego. Não remover os novos guardas de tenant como “rollback”, pois isso reabriria a exposição. Qualquer intervenção em produção requer autorização posterior explícita do proprietário.
