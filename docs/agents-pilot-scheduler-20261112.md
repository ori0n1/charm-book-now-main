# Bellza: piloto da Sentinela — preparação do agendador

**Estado: não registado nem ativado.** Esta proposta usa o Agendador de
Tarefas do Windows para iniciar apenas `scripts/agents/monitor.mjs` a cada
30 minutos. A criação da tarefa requer autorização específica posterior.

## Evidência local de 12/11/2026

- Base: commit `22c42d6`; worktree isolada
  `sentinela-periodica-phase6-20261112`.
- Serviço `Schedule`: `Running`, início `Automatic`. A consulta à tarefa
  `Bellza-Sentinela-Piloto` retornou inexistente.
- Conta do processo de teste: `silas\silas`, SID terminado em `-1001`.
- Um PowerShell novo com `-NoProfile -NonInteractive`, sob essa conta,
  executou diretamente o monitor real, sem API ou memória da Codex. O
  processo foi iniciado manualmente durante esta sessão. Fora do sandbox, o
  relatório registou `Autenticação: READY`, Worker
  `9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8`, 53 bindings e a pendência
  conhecida `OFFICIAL_RECORD_OUTDATED`. A primeira tentativa dentro do
  sandbox registou `AUTH_UNAVAILABLE` localmente; a execução seguinte
  registou `RECOVERED`. A diferença é compatível com a restrição de rede
  do sandbox; não indica alteração da produção.
- Foram construídos **somente em memória** os objetos de ação, gatilho,
  principal e limites da tarefa. A ação aponta para Node local, com a
  worktree como diretório de trabalho. O principal foi `silas\silas`,
  `Interactive`, `Limited`; repetição `PT30M`, sem duração final;
  `MultipleInstances=IgnoreNew`, limite `PT3M`, zero reinícios.
- `npm.cmd run bellza:access-check` foi tentado por instrução local, mas
  este commit não contém esse script. O teste direcionado do monitor
  confirmou OAuth restrito e leitura real; não foi feita auditoria geral.

O modo `Interactive` exige que `silas\silas` esteja com sessão Windows
iniciada; **não** exige Codex aberto. O modo `S4U` foi excluído porque não
fornece acesso à rede. Nenhuma senha, token ou segredo é copiado para a
tarefa. A leitura Cloudflare usa apenas o OAuth restrito existente; o
monitor bloqueia a consulta se o escopo se ampliar ou a autenticação
falhar. A Sentinela continua limitada a GETs conhecidos. O monitor
mantém lock local, retenção e alertas locais sem repetição.

## Comando proposto para criação futura

Executar **apenas depois de autorização específica**, numa sessão
PowerShell da conta `silas\silas`. Não usar `-Force` nem trocar o principal
por `SYSTEM`, `S4U` ou uma conta com privilégios ampliados.

```powershell
$worktree = 'C:\Users\silas\OneDrive\Desktop\charm-book-now-main\charm-book-now-main.worktrees\agents-full-audit-correction-deploy-bellza\sentinela-periodica-phase6-20261112'
$action = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument 'scripts/agents/monitor.mjs' -WorkingDirectory $worktree
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Minutes 30)
$principal = New-ScheduledTaskPrincipal -UserId 'silas\silas' -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -RestartCount 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Bellza-Sentinela-Piloto' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Leitura local da Sentinela Bellza a cada 30 minutos; sem notificações externas'
```

O gatilho sem `RepetitionDuration` repete indefinidamente. O limite do
monitor continua em 120 segundos; os 3 minutos no Agendador são um limite
externo. `IgnoreNew` e a lock do monitor impedem sobreposição. O comando
não contém tokens nem configurações de produção.

Após autorização e registo, confirmar principal, ação, repetição, estado e
primeira execução no próprio Agendador antes de considerar o piloto ativo.
Se a tarefa não tiver o mesmo perfil OAuth ou rede, desativá-la e manter
apenas a execução manual. A validação do processo separado não substitui
essa verificação da tarefa efetivamente registada.

## Desativação futura

```powershell
Disable-ScheduledTask -TaskName 'Bellza-Sentinela-Piloto'
```

Para consultar o estado sem mudar a tarefa:

```powershell
Get-ScheduledTask -TaskName 'Bellza-Sentinela-Piloto' | Select-Object TaskName,State,Principal,Actions,Triggers,Settings
Get-ScheduledTaskInfo -TaskName 'Bellza-Sentinela-Piloto' | Select-Object LastRunTime,LastTaskResult,NextRunTime
```

## Limites do piloto

- Depende de sessão Windows iniciada, computador ligado e rede acessível.
- A renovação OAuth não interativa funcionou neste perfil, mas pode exigir
  novo consentimento humano no futuro. Falha de autenticação gera apenas
  relatório local e interrompe as leituras Cloudflare; não recorre a token
  alternativo.
- A conta efetiva e a rede da **tarefa agendada** ainda não podem ser
  comprovadas sem registá-la. Essa é a verificação pendente após a
  autorização específica.
- O histórico fica nesta worktree e não é enviado para fora. A worktree e
  Node precisam continuar no mesmo caminho durante o piloto.

Referências: [Microsoft — tipos de logon](https://learn.microsoft.com/en-us/windows/win32/taskschd/principal-logontype),
[Microsoft — duração da repetição](https://learn.microsoft.com/en-us/windows/win32/taskschd/repetitionpattern-duration).
