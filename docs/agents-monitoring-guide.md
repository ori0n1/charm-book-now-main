# Bellza: monitorização manual da Sentinela

Esta worktree deriva de `b29c058`. A Sentinela usa o OAuth oficial guardado
pelo Wrangler no perfil Windows. O agente lê esse OAuth apenas para quatro
GETs Cloudflare previamente permitidos e dois GETs públicos (`/` e `/login`).
O código recusa outros métodos, URLs, parâmetros e redirecionamentos; não
existe comando de escrita ou de publicação para os agentes.

## Nova sessão no mesmo computador

```powershell
$env:CLOUDFLARE_API_TOKEN = $null
& '..\node_modules\.bin\wrangler.cmd' whoami
npm.cmd run agents:sentinela
npm.cmd run agents:status
```

`whoami` deve mostrar uma sessão OAuth válida; a Sentinela usa somente o
ficheiro OAuth do Wrangler, nunca um token de API alternativo. Se a sessão
expirar, executar interativamente:

```powershell
& '..\node_modules\.bin\wrangler.cmd' login --scopes account:read user:read workers_tail:read
```

Concluir a autenticação na janela aberta pelo Wrangler. **Não usar `login`
sem `--scopes`**: o padrão da versão instalada pede também permissões de
escrita. Se o navegador, a rede ou a autorização impedirem o fluxo, parar
essa consulta, registar `AUTH_UNAVAILABLE`, `AUTH_REJECTED` ou
`NETWORK_UNAVAILABLE` conforme o relatório e pedir a intervenção humana
necessária. Não copiar tokens para o repositório, prompts ou argumentos.

`npm.cmd run agents:check` executa o fluxo completo, incluindo os sete
testes locais da Valida. Um estado `ATENCAO`, `BLOQUEADO` ou
`INDETERMINADO` pode resultar em código de saída não zero **mesmo quando o
relatório foi gravado**. Os ficheiros locais ignorados pelo Git ficam em
`.bellza-agent-state/latest-sentinela.md`, `runs/<runId>.json` e
`history.jsonl`; permanecem entre sessões na mesma worktree. O histórico
recente tem limite de 200 eventos; os relatórios por ID permanecem no disco.
Numa nova worktree ou noutro computador, o código acompanha o commit, mas o
histórico local e a sessão OAuth têm de ser verificados novamente.

A observação inclui a versão ativa, nomes/tipos de bindings, runtime, crons,
checks e diferenças frente ao manifesto, sem valores de secrets. Nenhuma
verificação desta fase consulta clientes, reservas, pagamentos ou dados de
estúdios. A lista do manifesto é referência de monitorização; uma diferença
exige investigação da origem antes de qualquer atualização da referência.
Não há agendamento recorrente.
