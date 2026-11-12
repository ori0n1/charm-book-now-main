# Bellza: agenda e reservas, primeira leitura funcional (fase 9)

**Estado: BLOQUEADA para produção.** Esta worktree deriva de `bc5e048`.
A tarefa Windows da Sentinela permanece na worktree anterior e não foi
modificada. Nenhuma consulta funcional ao Supabase foi executada.

## Evidência de acesso

- A primeira verificação de 12/11/2026 procurou
  `%LOCALAPPDATA%\Bellza` no perfil apresentado pelo sandbox e no
  perfil Windows comum, sem encontrar os ficheiros. A investigação
  direcionada posterior encontrou `sql-catalog.json`, a CA e
  `vault-unlock.clixml` em
  `AppData\Local\Packages\OpenAI.Codex_2p2nqsd0c76g0\LocalCache\Local\Bellza`.
  Também encontrou ficheiros do registo e do armazenamento cifrado do
  SecretStore nesse perfil empacotado. Nenhum conteúdo secreto foi
  lido, copiado ou exposto.
- O PowerShell do contexto atual, com e sem substituição temporária
  de `LOCALAPPDATA` nesse processo, não reconheceu
  `BellzaCatalogVault` como vault registado. A configuração antiga
  contém a referência de projeto correta e um host com o formato do
  pooler esperado, mas a sessão SQL, o certificado TLS e a role
  efetiva não puderam ser verificados.
- A última evidência técnica disponível em
  `docs/bellza-access.md` da branch candidata
  `agent/bugs/clientes-duplicados-seguros-20261107-005100` é de
  08/11/2026: a role `bellza_catalog_reader` estava `NOLOGIN` e
  herdava escrita efetiva por grants a `PUBLIC`. A situação **atual**
  da role não pôde ser reconfirmada por uma sessão SQL segura.
- A CLI Supabase comprova visibilidade do projeto, não a role efetiva.
  O endpoint `database/query/read-only` observado com `BYPASSRLS`
  não é utilizado. Não se usou service role, token administrativo,
  credencial de escrita ou acesso do browser SQL Editor como fonte do
  agente.
- `npm.cmd run bellza:access-check` foi tentado nesta worktree por
  instrução local, mas o script não existe em `bc5e048`. Isso não
  substitui a verificação específica da role e da fonte funcional.

## Implementação local

`agents/agenda-reservas-source.mjs` contém a porta para um futuro
leitor de agregados por estúdio. Ela exige, **antes de qualquer leitura**,
prova da mesma sessão de leitura para o projeto `pwmdzpvnatrvfpgcvnzg`, role com LOGIN,
sem superutilizador, `BYPASSRLS`, privilégios de escrita ou caminho
`SECURITY DEFINER` capaz de escrita, transação somente leitura, RLS
efetiva e isolamento entre estúdios comprovado. Também exige exatamente
os estúdios solicitados e rejeita campos inesperados ou pessoais. A
porta não cria credenciais nem fornece um adaptador SQL ativo. Um objeto
de prova sintético usado nos testes **não é autorização para produção**.

A Sentinela identifica por estúdio falhas de carregamento da agenda,
erros de consulta, divergências de disponibilidade, estados
inconsistentes de reservas e falhas de processamento. O relatório
mostra contagens de anomalias separadas por estúdio; uma diferença
observada não é automaticamente declarada erro de negócio sem
referência específica. Sherlock mantém causas indeterminadas sem
evidência causal; Forge não aplica correções; Valida executa os sete
contratos locais sem rede; Guardião não autoriza publicação. Atlas
guarda IDs, dependências, alertas sem duplicação e histórico local.

## Comandos manuais e resultado

```powershell
npm.cmd run agents:functional-check
npm.cmd run agents:functional-check -- --simulate=agenda-reservas
npm.cmd run test:agents
```

O primeiro comando produziu inicialmente
`BLOCKED_LOCAL_READ_CONFIG_MISSING`; após localizar o perfil
empacotado e atualizar o diagnóstico, produziu
`PENDENTE_ACESSO_FUNCIONAL / BLOQUEADA`,
`BLOCKED_PROFILE_ISOLATION`, zero anomalias observadas
e zero alertas. Isso **não demonstra ausência de falhas reais**. O
segundo comando, sem rede e com dados fictícios, produziu cinco
anomalias no `STUDIO_27` e zero no `STUDIO_EXEMPLO`, com cinco
alertas locais novos; todas as causas ficaram
`NAO_DETERMINADA`. Valida aprovou apenas os testes locais e
Guardião ficou `INDETERMINADO`. O CLI devolve código não zero
para acesso pendente ou anomalias sintéticas por decisão explícita.

Relatórios locais ignorados pelo Git:
`.bellza-agent-state/functional-manual/latest-functional.md` e
`.bellza-agent-state/functional-simulated/latest-functional.md`.
O modo `adapter-test` só está disponível na API local e marca
expressamente a prova e os dados como simulação; não há opção de CLI
que aceite dados ou credenciais arbitrários, nem um modo de leitura
funcional real ativo. Nenhuma verificação funcional foi incluída
no agendamento.

## Próximo passo mínimo

No perfil autorizado do SecretStore, confirmar por metadados se a
entrada `Bellza-Supabase-Prod-CatalogReader` ainda existe, sem
copiar o vault cifrado ou a credencial para este perfil. Mesmo que
exista, a última evidência da role aponta para `NOLOGIN` e escrita
herdada de `PUBLIC`: é necessária uma fonte efetivamente sem
capacidade de escrita antes de a usar no agente. Qualquer correção de
role, grants, credencial ou RLS em produção requer **autorização
específica separada**, depois de rever o impacto. Só então validar
TLS, role efetiva e isolamento por estúdio numa sessão permitida,
integrar o adaptador e pedir autorização específica para leitura
recorrente. A tarefa piloto não foi modificada.
