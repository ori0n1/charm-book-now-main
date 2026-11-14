# API privada de diagnostico Bellza (candidata local)

Estado: **somente simulacao local**. O adaptador PostgREST de leitura esta
preparado, mas bloqueado sem prova RLS e sessao autorizada. O servidor atual
recusa esse adaptador: nenhuma fonte Supabase, Stripe ou dados reais esta ligada.
A API nao esta instalada no gateway Telegram nem em tarefas Windows.

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

## Fonte PostgREST preparada

O caminho minimo observado no codigo Bellza e a autenticacao Supabase da
aplicacao seguida de leitura direta de `appointments` por `studio_id`. A
aplicacao tambem acompanha `booking_payment_requests` por Realtime; o GET
proposto nessa tabela ainda depende de verificacao dos grants e da RLS.
A rotina de agenda protegida existente usa `service_role` e carrega dados
de clientes; por isso nao foi reutilizada.

O adaptador `agents/private-api/postgrest-source.mjs` aceita somente a chave
publica `sb_publishable_`, uma sessao de utilizador verificada pela Auth API,
uma tabela explicita de codigo de estudio para UUID e prova revista de RLS,
isolamento e efeitos das funcoes usadas nas politicas. Ele executa somente
GET em `/auth/v1/user`, `/rest/v1/user_roles`, `/rest/v1/studios`,
`/rest/v1/appointments` e `/rest/v1/booking_payment_requests`. Verifica
membership e estudio ativo antes de consultar agenda/reservas. Nao chama RPC,
SQL, Stripe ou rotinas SECURITY DEFINER diretamente. Seleciona apenas
`studio_id`, `status` e horarios nas tabelas de negocio. Na verificacao de
membership usa apenas IDs tecnicos e `role`; nunca seleciona clientes,
telefones ou valores financeiros. Cada consulta tem janela fixa de 30 minutos, limite de
200 linhas, resposta ate 64 KiB e prazo de 1,8 segundo. Se 201 linhas forem
atingidas, a cobertura torna-se `NOT_VERIFIABLE`.

A leitura futura de agenda prova apenas que a consulta basica responde;
disponibilidade e carregamento visual continuam indeterminados. A leitura de
reservas conta registos visiveis, mas nao comprova consistencia financeira ou
de estados sem regras e fontes adicionais aprovadas. O resultado e `PARTIAL`,
com metricas desconhecidas em `null`, nunca um indicador verde completo.
Notificacoes, pagamentos e processamento ficam `NOT_VERIFIABLE`.

Uma prova passada ao adaptador em testes e **simulada** e nao valida as
politicas reais. Sem prova ativa ou sessao autenticada, nenhuma requisicao sai
do processo. Uma sessao pessoal existente serve apenas a um eventual teste
manual supervisionado; nao deve ser copiada para o gateway ou para rotina
automatica: o JWT desse utilizador pode permitir outras operacoes fora deste
adaptador. Ainda nao ha identidade automatica de menor privilegio aprovada.

## Ligacao futura, sujeita a autorizacao especifica

1. Rever na sessao administrativa ja autorizada os grants e politicas SELECT
   ativos de `user_roles`, `studios`, `appointments` e
   `booking_payment_requests`, incluindo funcoes chamadas pelas politicas.
   Confirmar que nenhum GET dispara efeito indireto. Registrar prova datada.
2. Confirmar os UUIDs reais de dois estudios autorizados e demonstrar, numa
   sessao autenticada sem privilegio administrativo, que o filtro de um
   estudio nao devolve linhas do outro. Um resultado vazio por si so nao prova
   isolamento; usar identidades e fixtures de teste apropriadas.
3. Testar falhas de autenticacao, cruzamento de estudios, limites, timeouts,
   regressao de agenda/reservas e ausencia de dados pessoais. O primeiro teste
   manual real deve consultar apenas uma janela de 30 minutos de um estudio,
   com o JWT mantido na sessao de origem e sem imprimir respostas brutas.
4. Somente apos autorizacao separada, preparar uma identidade automatica
   adequada, armazenamento seguro da chave HMAC e habilitar o adaptador no
   servidor. O gateway recebe apenas a chave HMAC da API local, nunca o JWT
   Supabase ou uma chave administrativa.

Ativacao: preservar as tarefas atuais; primeiro teste manual isolado, depois
atualizacao controlada do consumidor com configuracao anterior guardada.
Reversao: desativar o consumidor da nova API e restaurar a acao anterior,
sem alterar historicos; qualquer mudanca de banco ou permissao exige seu
proprio plano de reversao e autorizacao. Nenhuma ativacao e autorizada aqui.
