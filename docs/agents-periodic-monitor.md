# Bellza: monitorização periódica preparada (fase 6)

Base local: `dc081d1`. O agendamento **não está ativado**. A configuração
versionada em `agents/monitor-config.json` declara o intervalo previsto de
30 minutos, quatro GETs Cloudflare e dois GETs públicos por execução,
limite total de 120 segundos, até 12 alertas locais por execução e 1440
registos no histórico do monitor (cerca de 30 dias a cada 30 minutos).
Não há envio externo nem capacidade de correção ou publicação.

## Execução manual

```powershell
npm.cmd run agents:monitor
npm.cmd run agents:monitor -- --simulate=baseline
npm.cmd run agents:monitor -- --simulate=version-change
npm.cmd run agents:monitor -- --simulate=metadata-change
npm.cmd run agents:monitor -- --simulate=outage
npm.cmd run agents:monitor -- --simulate=auth-unavailable
npm.cmd run agents:monitor -- --simulate=recovery
npm.cmd run test:agents
```

Cada comando executa **uma** verificação e termina. As simulações usam IDs e
metadados fictícios, estado separado em
`.bellza-agent-state/monitor-simulated/` e nenhuma rede. Repetir `baseline`
mostra a supressão da divergência oficial conhecida. Repetir a mesma falha
não cria novo alerta; `recovery` regista a recuperação quando há prova.

O modo real verifica primeiro o ficheiro OAuth do Wrangler sem ler ou
registar valores de tokens. Aceita somente os escopos `account:read`,
`user:read`, `workers_tail:read` e `offline_access`; qualquer escopo de
escrita bloqueia a consulta. Executa `wrangler whoami` sem saída visível,
sem tokens alternativos de ambiente e com limite de 20 segundos, depois
confere novamente os escopos e a expiração. Se não houver OAuth seguro, o
comando regista `AUTH_SCOPE_UNSAFE` ou `AUTH_UNAVAILABLE` localmente e **não
consulta a produção**. Se estiver pronto, Atlas inicia apenas a Sentinela,
com a lock e os limites existentes. Não há login interativo no comando:
renovação que exija navegador é tarefa humana.

O monitor mantém uma lock para toda a verificação e grava
`.bellza-agent-state/monitor-state.json` e `latest-monitor.md`. O JSON
contém IDs, códigos, versões, hashes de metadados e eventos locais, sem
valores de bindings, credenciais ou dados pessoais. Regista novos problemas,
mudanças de versão/metadados e recuperação comprovada; uma leitura
Cloudflare bloqueada não apaga uma falha anterior por falta de evidência.
O Sherlock fornece apenas hipóteses fixas do diagnóstico, nunca uma causa
inventada. `OFFICIAL_RECORD_OUTDATED` permanece como pendência conhecida
sem alerta repetido. Os relatórios individuais do Atlas continuam com a
retenção do monitor: ao sair do histórico de 1440 execuções, um JSON da
Sentinela só é removido se o ID e o agente corresponderem e não houver outra
referência retida. Um ficheiro incerto fica para revisão local.

## Ativação futura

Em 12/11/2026, um processo novo renovou o OAuth **sem navegador** depois da
expiração (de 15:12:57 para 16:13:24 UTC), preservou os escopos de leitura
e concluiu os GETs da Sentinela. Após autorização específica para agendar,
usar um agendador local do mesmo
utilizador Windows e da mesma worktree, invocando **uma vez**
`node scripts/agents/monitor.mjs` a cada 30 minutos. Antes disso, confirmar
que o contexto **efetivo do agendador** tem rede permitida e acesso ao mesmo
perfil Wrangler com os escopos restritos. Se qualquer condição falhar, deixar o
agendamento desativado. Não conceder escopos de escrita nem criar tokens
alternativos para o fazer funcionar.

O estado local acompanha esta worktree entre sessões, mas não é partilhado
com outras worktrees ou máquinas. O código e estas regras acompanham o
commit. Nenhuma tarefa recorrente, alerta externo ou serviço adicional foi
criado nesta fase.
