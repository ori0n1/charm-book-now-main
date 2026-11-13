# Bellza Fase 26 — coordenação local do Atlas

Base: `d6f3e71`. Esta worktree é candidata. A tarefa Windows `Bellza-Telegram-Gateway` continua a executar a versão anterior; nenhuma configuração, credencial ou histórico ativo foi alterado.

## Como funciona

Num pedido de investigação completa, o modelo seleciona apenas `task_coordinate`. O Atlas cria uma tarefa principal com ID, consulta o último relatório pela Sentinela e encaminha o diagnóstico ao Sherlock. Se o código da anomalia disser respeito à aplicação, páginas públicas, agenda, reservas, clientes, notificações ou pagamentos, o Atlas **pede aprovação** para os testes sintéticos do Valida; não os executa antes do botão `Aprovar`. Só consulta o Forge quando o Sherlock tem causa comprovada e os testes relevantes foram aprovados. Forge avalia um plano sem aplicar patch. No máximo quatro tarefas filhas são criadas por pedido; não há ciclos de mensagens entre bots.

As tarefas, dependências, eventos e aprovações ficam no estado persistente do Atlas, sem guardar a mensagem recebida. O mesmo ID de atualização não cria novas tarefas. Um diagnóstico recente só é reutilizado quando corresponde à mesma execução do monitor, ao mesmo estúdio e a um relatório Sentinela atual consultado. Após reinício, trabalho interrompido fica bloqueado para revisão. Limites existentes de frequência, custo da IA, 30 tarefas por dia, uma execução ativa, 75 segundos por execução e aprovação de uso único com 15 minutos continuam em vigor.

Pedidos e eventos do monitor são serializados antes de gravar o histórico de tarefas. Um evento pode aguardar a conclusão de uma investigação, mas não sobrescreve o estado dessa investigação.

Os resumos do Atlas, Sherlock, Valida e Forge usam português direto e identificam causa incerta, falhas, testes pendentes e ausência de alterações. `Ver detalhes` mostra IDs, dependências, códigos, fontes e horários de Portugal; só o bot que criou a tarefa pode abrir os seus detalhes. Quando necessário, divide a resposta técnica em mensagens curtas. Os botões antigos de aprovação mantêm o mesmo alcance: testes sintéticos locais e, em pedidos individuais já existentes, propostas reversíveis em worktree isolada. Nenhum botão autoriza produção, staging, deploy, push, migração ou escrita em dados reais.

## Comandos locais

```powershell
node scripts/agents/telegram-atlas-coordinate-simulate.mjs
node --test tests/agents/phase26-atlas-coordination.test.mjs
```

O primeiro comando usa apenas fixtures e estado temporário; simula a decisão de aprovação para demonstrar toda a sequência, sem Telegram nem credenciais. Os testes usam clientes Telegram e IA falsos. Guardião permanece desativado.

## Ativação e reversão futuras

Exigem autorização específica. Confirmar a worktree limpa e o commit candidato; guardar a ação atual da tarefa `Bellza-Telegram-Gateway`. Preservar a configuração privada, DPAPI, o diretório de estado, os cinco bots e os argumentos `serve --monitor-events --tasks`. Encerrar só o gateway, alterar apenas o caminho da ação para esta worktree e iniciar a mesma tarefa. Verificar uma única instância, autenticação dos cinco bots, alertas existentes e um pedido controlado. Se falhar, restaurar a ação guardada e reiniciar a versão anterior. Não modificar `Bellza-Sentinela-Piloto`.

Limitação: a seleção da ferramenta pelo modelo real ainda não foi testada nesta versão, pois o gateway ativo não foi atualizado e não foram enviadas mensagens Telegram. Causa real não comprovada continua a bloquear propostas de patch; testes sintéticos não comprovam saúde da produção.
