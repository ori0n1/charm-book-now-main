# Bellza Fase 18 — Atlas e Sentinela no Telegram

**Preparado, sem ligação ativa.** O gateway da Fase 17 foi mantido. A configuração privada em `%LOCALAPPDATA%\Bellza\TelegramGateway\config.json` ativa apenas Atlas e Sentinela, restringe o acesso ao ID pessoal informado pelo proprietário e verifica os IDs dos dois bots no `getMe`. Sherlock, Valida, Forge e Guardião continuam desativados; a ausência de Guardião não bloqueia o piloto. O ficheiro de configuração fica fora do Git, tem herança de ACL desligada e uma única regra de acesso para o utilizador Windows atual.

## Estado observado em 13/11/2026

- O autoteste DPAPI com um segredo **sintético** confirmou encriptação, desencriptação no perfil atual e ACL isolada. Os tokens reais não foram lidos nem criados.
- As entradas `telegram-atlas`, `telegram-sentinela` e `openai-api` estão ausentes. `auth-check` devolve `CREDENTIAL_MISSING` para os três, sem fazer chamadas remotas.
- O gateway está **PARADO**. A tarefa Windows `Bellza-Sentinela-Piloto` não foi alterada.
- A leitura do histórico local da Sentinela encontrou 40/40 páginas públicas com HTTP e recursos aprovados, incluindo Capivara e Studio 27, em `2026-11-13T11:18:48.514Z`. A interatividade da agenda permanece `NAO_VERIFICAVEL`. Trata-se de um relatório já gravado, não de uma consulta efetuada pelo Telegram.

## Introdução das credenciais pelo proprietário

Executar estes comandos **no seu próprio PowerShell**, na raiz desta worktree. `Read-Host -AsSecureString` recebe o valor sem o mostrar ou colocá-lo na linha de comando. Não enviar tokens ou chave API para a Codex ou para o chat.

```powershell
powershell -NoProfile -File scripts/agents/telegram-secrets.ps1 -Mode set -Name telegram-atlas
powershell -NoProfile -File scripts/agents/telegram-secrets.ps1 -Mode set -Name telegram-sentinela
powershell -NoProfile -File scripts/agents/telegram-secrets.ps1 -Mode set -Name openai-api
```

O script guarda cada valor com DPAPI do utilizador Windows e ACL restrita em `%LOCALAPPDATA%\Bellza\TelegramGateway\secrets`. Se uma entrada já existir, `set` substituirá apenas a entrada com o nome indicado; confirmar o nome antes de o executar. Não introduzir os tokens dos outros bots nesta fase.

Depois, executar apenas a verificação de autenticação, que chama `getMe` do Telegram e `GET /v1/models/gpt-6-luna` da OpenAI. Não faz polling, gera respostas, envia mensagens ou inicia o gateway.

```powershell
node scripts/agents/telegram-gateway.mjs auth-check
node scripts/agents/telegram-gateway.mjs status
node --test tests/agents/phase17-telegram.test.mjs tests/agents/phase18-telegram.test.mjs
```

`READY` para os três serviços comprova o token, a identidade dos dois bots e a visibilidade do modelo. Uma primeira resposta de linguagem natural e a faturação efetiva só poderão ser comprovadas numa conversa real após autorização específica.

## Primeira conversa futura

Depois de `auth-check` indicar três `READY` e de autorização específica para iniciar e responder pelo Telegram:

```powershell
powershell -NoProfile -File scripts/agents/telegram-gateway-control.ps1 -Mode start
powershell -NoProfile -File scripts/agents/telegram-gateway-control.ps1 -Mode status
powershell -NoProfile -File scripts/agents/telegram-gateway-control.ps1 -Mode stop
```

O serviço usa long polling e um lock local; não cria tarefa Windows. O início futuro permitirá mensagens **apenas** no chat privado cujo utilizador e chat coincidam com o ID configurado. As respostas incluem a fonte e a data do relatório. Perguntas sobre páginas usam o novo resumo por estúdio; HTTP 200 ou renderização não provam que a agenda interativa funciona. Comandos de shell, SQL, deploy, dados e ferramentas fora da lista de cada bot são recusados. Os alertas Telegram automáticos permanecem desligados.

## Custo e limites

O modelo configurado é `gpt-6-luna`. A configuração limita a 60 chamadas de IA por dia (até cerca de 30 perguntas com duas chamadas), 50 mil tokens reservados, US$ 0,25 estimados por dia e seis mensagens por minuto. A estimativa local pode bloquear cedo e não é um limite de faturação da conta OpenAI. Conferir o [preço oficial do modelo](https://developers.openai.com/api/docs/models) antes da ativação. Não houve consumo de API nesta fase.

Referências: [Telegram `getMe`](https://core.telegram.org/bots/api#getme) e [OpenAI Retrieve model](https://developers.openai.com/api/reference/resources/models/methods/retrieve).
