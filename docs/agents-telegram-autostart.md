# Gateway Telegram Bellza no Windows

A tarefa local `Bellza-Telegram-Gateway` inicia o único processo do gateway no
logon de `SILAS\silas`. Executa `scripts/agents/telegram-gateway-task.ps1`, que
mantém o Node ligado ao Agendador. A tarefa usa token interativo, nível
limitado, `IgnoreNew`, duração sem limite externo e até três reinícios com
intervalo de um minuto. Depende da sessão Windows iniciada, computador ligado
e rede disponível. O lock do gateway impede uma segunda instância.

Ativos: Atlas, Sentinela, Sherlock, Valida e Forge. Guardião permanece
desativado. Os alertas Telegram automáticos permanecem desativados; cada bot
responde apenas ao chat privado do proprietário. A Sentinela de 30 minutos é
uma tarefa separada e não é modificada por esta configuração. O gateway apenas
lê os seus relatórios locais; Valida executa testes sintéticos locais e Forge
não aplica patches.

Os tokens ficam no DPAPI do perfil Windows, fora do Git. Para abrir de novo a
janela dos três bots novos:

```powershell
powershell.exe -STA -NoProfile -File scripts/agents/telegram-secrets.ps1 -Mode gui-remaining
```

Consulta e paragem segura:

```powershell
schtasks.exe /Query /TN "\Bellza-Telegram-Gateway" /FO LIST
node scripts/agents/telegram-gateway.mjs status
Disable-ScheduledTask -TaskName Bellza-Telegram-Gateway
node scripts/agents/telegram-gateway.mjs stop
```

Para reativar a tarefa, usar `Enable-ScheduledTask -TaskName
Bellza-Telegram-Gateway` e `Start-ScheduledTask -TaskName
Bellza-Telegram-Gateway` no mesmo perfil Windows. A ativação não amplia
permissões dos agentes nem permite escrita em produção.
