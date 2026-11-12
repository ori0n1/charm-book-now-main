# Bellza: monitorização funcional preparada (fase 8)

Base local: `e7b0d7c`, numa worktree nova. A tarefa Windows
`Bellza-Sentinela-Piloto` continua a apontar para a worktree da fase 6;
este comando funcional **não foi adicionado ao agendamento**.

## Comandos manuais

```powershell
npm.cmd run agents:functional-check
npm.cmd run agents:functional-check -- --simulate=baseline
npm.cmd run agents:functional-check -- --simulate=issues
npm.cmd run agents:functional-check -- --simulate=recovery
npm.cmd run agents:functional-check -- --simulate=proof
node --test tests/agents/phase8.test.mjs
```

Cada comando executa uma vez. O modo padrão produz
`PENDENTE_ACESSO_FUNCIONAL` e **não faz consultas remotas**. As simulações
usam os códigos `STUDIO_27` e `STUDIO_EXEMPLO` com dados inteiramente
fictícios; não consultam nem representam o estado dos estúdios reais. O CLI devolve código não zero quando há
anomalias sintéticas ou acesso funcional pendente; isso não significa que
os testes locais falharam.

## Verificações preparadas

| Domínio | Contagens agregadas verificadas | Fonte real necessária |
| --- | --- | --- |
| Agenda | erro de carregamento; diferença na disponibilidade | leitura limitada por estúdio com RLS |
| Reservas | estado inconsistente; falha de processamento | leitura limitada por estúdio com RLS |
| WhatsApp | falha de envio, confirmação e lembrete | RLS e evidência de leitura do fornecedor |
| Pagamentos | divergência de sinal, total e estado apresentado | RLS e leitura Stripe efetivamente restrita |
| Clientes | falha de acesso, validação de telefone e candidatos a duplicado | leitura limitada por estúdio com RLS |

O contrato aceita apenas contagens inteiras e códigos de estúdio
restritos. Campos inesperados, como telefone, nome, email ou IDs de
clientes, são rejeitados antes de escrever histórico. A Sentinela
classifica anomalias por estúdio e gravidade. O Sherlock mantém a causa
como `NAO_DETERMINADA` sem prova. O Forge bloqueia proposta real;
`--simulate=proof` demonstra apenas uma proposta de agenda **não
aplicada** e identificada como sintética. A Valida executa os sete
contratos locais existentes com rede e credenciais de produção
bloqueadas. O Guardião nunca autoriza publicação a partir destas
fixtures.

O Atlas usa a sua lock e histórico existentes, gera identificadores e
dependências para cada etapa e grava relatórios locais em
`.bellza-agent-state/functional-*/`. Simulação e modo manual pendente
têm estados separados. Alertas `NEW` e `RECOVERED` usam a combinação
estúdio/código; uma falha repetida não cria outro alerta. A falta de
acesso real não é interpretada como recuperação. O diário e os alertas
mantêm até 1440 registos. Não há notificações externas.

## Integrações reais disponíveis

**Nenhuma das cinco fontes funcionais está ligada nesta fase.** O OAuth
Cloudflare restrito e os GETs de `/` e `/login` continuam disponíveis
para a Sentinela de infraestrutura, mas não comprovam agenda, reservas,
WhatsApp, pagamentos ou clientes. O guia de acesso Bellza ainda não
comprova uma role SQL de leitura utilizável com RLS efetiva, e não foi
apresentado acesso restrito de leitura aos fornecedores WhatsApp/Stripe.
Não se usou a role com `BYPASSRLS`, credenciais de escrita nem dados
reais.

Na primeira execução manual desta worktree, `--simulate=proof` gerou
uma anomalia fictícia de disponibilidade no `STUDIO_27`, causa
`CONFIRMADA_EM_SIMULACAO`, proposta não aplicada, Valida `APPROVED`
para testes locais e Guardião `INDETERMINADO`. O modo padrão gerou
`PENDENTE_ACESSO_FUNCIONAL`, zero alertas e Valida `APPROVED` apenas
para testes sintéticos. Estes resultados não demonstram saúde
funcional da produção.

## Antes de qualquer leitura real ou agendamento

É necessário comprovar uma fonte de leitura com RLS efetiva e
isolamento por estúdio, sem `BYPASSRLS` nem capacidade de escrita;
definir agregados mínimos por domínio; e verificar permissões de
leitura dos fornecedores quando aplicável. Essa integração exige
trabalho e autorização específicos. Após testes e revisão humana,
seria ainda necessária autorização específica para acrescentar a
monitorização funcional a qualquer agendamento. A tarefa piloto atual
não foi modificada.
