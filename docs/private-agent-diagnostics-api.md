# API privada de diagnostico Bellza (candidata local)

Estado: **somente simulacao local**. Nenhuma fonte Supabase, Stripe ou dados reais
estao ligados. A API nao esta instalada no gateway Telegram nem em tarefas Windows.

## Contrato

`GET /v1/studios/{STUDIO_CODE}/{dominio}`. Dominios fixos: `agenda`,
`reservas`, `processamento`, `notificacoes`, `pagamentos`. Cada resposta contem
somente codigo do estudio, instante, cobertura e contagens pequenas. A janela
de erros e de 30 minutos. Quando uma fonte nao esta disponivel, a resposta e
`NOT_VERIFIABLE` com `metrics: null`; nunca zero ficticio. Nao ha endpoint SQL,
formulario ou operacao de escrita.

O servidor liga somente a `127.0.0.1` com porta efemera. Cada GET exige HMAC
SHA-256 sobre metodo, caminho, horario e nonce, usando chave de ao menos 32
bytes por cliente. O servidor valida uma lista explicita de estudios por
cliente, janela de 60 segundos e nonce de uso unico. Limites: 30 pedidos por
minuto por cliente, duas consultas simultaneas e 2 segundos por leitura. Logs
registram apenas codigos de erro, sem cabecalhos, chave, URL livre ou resultados.
As chaves de teste sao geradas em memoria e descartadas ao terminar.

## Comandos locais

```powershell
npm.cmd run test:agents:private-api
npm.cmd run agents:private-api:simulate
```

A simulacao consulta Capivara e Studio 27 usando fixtures artificiais. Nao
representa o estado de producao. Codigos de anomalia de agenda e reservas sao
os mesmos da Sentinela; dominios indisponiveis nao geram recuperacao ficticia.
Nao ha comando para iniciar um servico real.

## Ligacao futura, sujeita a autorizacao especifica

1. Aprovar uma fonte de leitura privada com superficie exclusivamente GET,
   campos agregados e escopo por estudio. O gateway nao deve receber chave
   administrativa ou acesso SQL. O adaptador de producao ainda nao existe.
2. Provar que o backend usa apenas consultas sem efeitos, sem chamar rotinas
   `SECURITY DEFINER` nao revistas. Conferir schema exposto, role, grants,
   RLS ou isolamento equivalente com dois estudios, incluindo Studio 27.
3. Testar falhas de autenticacao, cruzamento de estudios, limites, timeouts,
   regressao de agenda/reservas e ausencia de dados pessoais. Confirmar a
   origem dos agregados antes de declarar o resultado operacional.
4. Somente apos aprovacao separada, instalar uma chave por cliente em
   armazenamento seguro e ativar o consumidor no Atlas/Sentinela.

Ativacao: preservar as tarefas atuais; primeiro teste manual isolado, depois
atualizacao controlada do consumidor com configuracao anterior guardada.
Reversao: desativar o consumidor da nova API e restaurar a acao anterior,
sem alterar historicos; qualquer mudanca de banco ou permissao exige seu
proprio plano de reversao e autorizacao. Nenhuma ativacao e autorizada aqui.
