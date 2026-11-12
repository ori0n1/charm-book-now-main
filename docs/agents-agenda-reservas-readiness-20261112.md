# Bellza: agenda e reservas, primeira leitura funcional (fase 9)

**Estado: BLOQUEADA para produção.** Esta worktree deriva de `bc5e048`.
A tarefa Windows da Sentinela permanece na worktree anterior e não foi
modificada. Nenhuma consulta funcional ao Supabase foi executada.

## Evidência de acesso

- Em 12/11/2026, a verificação local de existência, também fora do
  sandbox, não encontrou `sql-catalog.json`, a CA nem o ficheiro de
  desbloqueio do vault no perfil Windows. Não abriu ou copiou credenciais.
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

O primeiro comando produziu
`PENDENTE_ACESSO_FUNCIONAL / BLOQUEADA`,
`BLOCKED_LOCAL_READ_CONFIG_MISSING`, zero anomalias observadas
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

Por caminho oficial e **com autorização específica separada**,
disponibilizar uma fonte agregada de leitura para agenda e reservas
que comprove a role efetiva sem escrita nem `BYPASSRLS`, RLS por
estúdio e ligação TLS verificada. Só depois implementar e testar o
adaptador real contra essa fonte, com o conjunto de campos mínimos
acima. Não ativar a leitura recorrente antes dessa comprovação.
