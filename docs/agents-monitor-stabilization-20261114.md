# Estabilização local do monitor Bellza

Esta worktree é **CANDIDATA LOCAL**. `LIVE_READ_ONLY` designa a origem da observação do monitor, não comprova a correspondência do código local com a **PRODUÇÃO ATIVA**. **STAGING** continua um ambiente separado. Nenhuma referência oficial, tarefa Windows ou gateway ativo foi alterado.

## Alterações

- Atlas agrupa oscilações do mesmo incidente durante duas horas. Avisos comuns de leitura Cloudflare e `VISUAL_REQUEST_FAILED` aguardam duas observações e 30 minutos; falhas críticas continuam imediatas. No máximo três avisos novos comuns por hora; persistências e críticos ficam fora deste limite. Recuperação só é enviada quando um aviso daquele ciclo foi confirmado como enviado.
- `VISUAL_REQUEST_FAILED` indica cobertura incompleta do monitor, inclusive quando o próprio `route.fetch` falha. O relatório fica `PARCIAL` quando essa é a única anomalia. Não comprova falha da página; erros HTTP, recursos essenciais e JavaScript conservam a classificação própria.
- Alertas da Sentinela usam português curto, hora de Portugal e o botão **Ver detalhes**, limitado ao chat privado do proprietário. Código, ID e evidência técnica ficam nos detalhes. O histórico local anterior mantém o mesmo formato de estado, inclusive IDs de saída antigos.
- Guardião faz uma revisão interna dos incidentes, testes e propostas. Sem origem comprovada da produção e rollback validado, o parecer permanece `INDETERMINADO` ou `BLOQUEADO`; o bot Guardião continua desativado.
- O acesso funcional Supabase continua **BLOQUEADO**. O contrato local rejeita leitura sem TLS/CA e hostname comprovados, sem ausência de escrita herdada de `PUBLIC`, sem colunas mínimas ou sem RLS e isolamento. Não houve consulta SQL nem acesso ao vault.

## Evidência e limites

O diário local anterior registou vários pares `NEW:AUTH_UNAVAILABLE` / `RECOVERED:AUTH_UNAVAILABLE` e eventos `VISUAL_REQUEST_FAILED`. O código do monitor distingue renovação OAuth, rede, limite de pedidos e API Cloudflare, mas os eventos antigos não comprovam qual dessas causas ocorreu em cada oscilação. Não atribuir causa à aplicação. A correspondência do código desta worktree à versão ativa do Worker não foi verificada nesta etapa; qualquer patch da aplicação dependente dessa origem permanece bloqueado.

## Ativação e reversão propostas

Exigem autorização específica posterior. Antes da ativação, confirmar o commit e a worktree limpa, exportar a ação atual da tarefa `Bellza-Telegram-Gateway` e guardar o caminho anterior. Preservar DPAPI, estado de incidentes, alertas e tarefas. Atualizar só essa ação para o gateway desta worktree, reiniciar apenas o gateway, confirmar uma instância, cinco bots, alertas, botão de detalhes e ausência de reenvio histórico. Não alterar `Bellza-Sentinela-Piloto`.

Se uma proteção falhar, parar apenas o gateway candidato, restaurar a ação guardada, reiniciar o gateway anterior e confirmar cinco bots e alertas com o histórico intacto. Não executar rollback de produção. A monitorização automática atual continua intacta até essa autorização.

A correção da classificação no próprio relatório visual exige **outra autorização específica** para atualizar a tarefa `Bellza-Sentinela-Piloto`. Antes disso, testar o monitor candidato manualmente, guardar a ação da Sentinela ativa, preservar o estado visual, confirmar Cloudflare, HTTP e visual no mesmo ciclo e depois alterar somente essa tarefa. Em falha crítica, restaurar apenas a ação anterior da Sentinela e confirmar o ciclo antigo, sem perder histórico. Ativar o gateway e a Sentinela em passos separados evita misturar os efeitos.
