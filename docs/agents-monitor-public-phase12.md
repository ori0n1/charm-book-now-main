# Bellza — monitor integrado Cloudflare + páginas públicas (fase 12)

Base local: `7da0a86`. O comando existente `node scripts/agents/monitor.mjs`
continua a ser a única entrada do ciclo Atlas/Sentinela. Agora ele executa
a leitura Cloudflare e chama o verificador público da fase 11 **dentro da
mesma `monitor.lock`**. O componente público conserva relatório e estado
próprios em `.bellza-agent-state/public-integrated/`, identificados pelo
mesmo ciclo no diário do monitor. Uma falha pública não elimina a leitura
Cloudflare. A divergência `OFFICIAL_RECORD_OUTDATED` continua conhecida e
sem alertas repetidos; falhas coincidentes de `/` ou `/login` têm um só
alerta no resumo consolidado.

O monitor mantém o limite interno de 120 segundos, com até 90 segundos
para a Sentinela Cloudflare, até 70 segundos para varrer páginas públicas
e reserva de 20 segundos para testes locais e escrita. Quando o tempo
restante não basta, a cobertura pública fica indeterminada. A verificação
pública mantém apenas GET/HEAD, até 90 pedidos, no máximo 60 páginas,
intervalo mínimo de 200 ms, 7 segundos por pedido e HTML limitado a
128 KB. Valida executa contratos locais com limite de 2,5 segundos por
teste no ciclo automático; resultado não executado é indeterminado, não
aprovado. Histórico e alertas públicos retêm 240 entradas e os relatórios
antigos identificados são removidos localmente.

## Comandos manuais nesta worktree

```powershell
node scripts/agents/monitor.mjs
node scripts/agents/monitor.mjs --simulate=public-studio-failure
node scripts/agents/monitor.mjs --simulate=public-resource-failure
node --test tests/agents/phase6.test.mjs tests/agents/phase11.test.mjs tests/agents/phase12.test.mjs
```

Simulações são locais e separadas de `.bellza-agent-state/` real. O comando
`public-check.mjs` da fase 11 permanece disponível para verificação manual
isolada; a tarefa agendada usa **somente** `monitor.mjs`.

## Evidência antes da ativação

- 24 testes dirigidos passaram: monitor antigo, páginas públicas e ciclo
  integrado. Incluem falha pública sem interromper Cloudflare, alertas
  novos/recuperados sem duplicação, `/login` deduplicado, lock e retenção.
- Execução manual real em 2026-11-12: OAuth `READY`, Worker
  `9c7bc0a2-09a6-45fe-9fe2-6674764cd9b8`, 53 bindings, páginas
  **40/40**, sitemap OK, 57 GET/HEAD públicos, nenhum alerta novo.
  A pendência `OFFICIAL_RECORD_OUTDATED` permaneceu conhecida.
- A tarefa Windows existente foi consultada sem alteração: ação
  `C:\Program Files\nodejs\node.exe` com argumento
  `scripts/agents/monitor.mjs`; diretório de trabalho
  `C:\Users\silas\OneDrive\Desktop\charm-book-now-main\charm-book-now-main.worktrees\agents-full-audit-correction-deploy-bellza\sentinela-periodica-phase6-20261112`.
  Conta apresentada: `silas`; logon interativo, privilégios limitados,
  `IgnoreNew`, `PT30M`, limite externo `PT3M`.

## Substituição futura — exige autorização específica

Nova versão candidata, caminho exato:

```text
C:\Users\silas\OneDrive\Desktop\charm-book-now-main\charm-book-now-main.worktrees\agents-full-audit-correction-deploy-bellza\public-monitor-phase12-20261112
```

Após autorização para alterar **apenas** `Bellza-Sentinela-Piloto`:

1. Conferir commit, worktree limpa e resultados acima. Exportar a
   definição atual da tarefa para um ficheiro local e guardar a ação
   anterior. Desativar a tarefa, aguardar qualquer execução em curso e
   confirmar ausência de `monitor.lock` no diretório anterior.
2. Fazer cópia local de segurança do `monitor-state.json` candidato e
   copiar para ele o `monitor-state.json` da worktree antiga. Isso
   conserva problemas já conhecidos e evita alertas novos artificiais.
   Validar o JSON e não copiar tokens nem ficheiros OAuth. Manter o
   estado público criado pela verificação manual da nova worktree.
3. Substituir **somente** a ação e o diretório de trabalho:

   ```powershell
   $newWorktree = 'C:\Users\silas\OneDrive\Desktop\charm-book-now-main\charm-book-now-main.worktrees\agents-full-audit-correction-deploy-bellza\public-monitor-phase12-20261112'
   $newAction = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument 'scripts/agents/monitor.mjs' -WorkingDirectory $newWorktree
   Set-ScheduledTask -TaskName 'Bellza-Sentinela-Piloto' -Action $newAction
   ```

4. Confirmar que conta, logon, privilégios, gatilho de 30 minutos,
   `IgnoreNew` e `PT3M` ficaram idênticos. Reativar a tarefa, iniciar
   uma execução de prova **pela tarefa registada** e confirmar OAuth,
   Cloudflare, cobertura pública, relatórios e próxima execução.
5. Se uma proteção falhar, desativar a tarefa e restaurar a ação
   anterior, sem alterar os outros parâmetros:

   ```powershell
   $oldWorktree = 'C:\Users\silas\OneDrive\Desktop\charm-book-now-main\charm-book-now-main.worktrees\agents-full-audit-correction-deploy-bellza\sentinela-periodica-phase6-20261112'
   $oldAction = New-ScheduledTaskAction -Execute 'C:\Program Files\nodejs\node.exe' -Argument 'scripts/agents/monitor.mjs' -WorkingDirectory $oldWorktree
   Set-ScheduledTask -TaskName 'Bellza-Sentinela-Piloto' -Action $oldAction
   ```

Nenhum desses passos de alteração foi executado nesta fase. Não houve
deploy, push, migração, mudança OAuth ou nova tarefa agendada.
