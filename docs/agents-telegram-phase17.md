# Bellza Fase 17 — Gateway Telegram local

Estado: **implementado e testado com Telegram e IA simulados; não ativado**. O serviço faz long polling de seis bots num único processo Node no perfil Windows do proprietário. Nenhuma porta pública, tarefa agendada ou mensagem real é criada nesta fase. A tarefa `Bellza-Sentinela-Piloto` permanece independente.

## Identidades e ferramentas

| Bot | Ferramentas permitidas |
| --- | --- |
| Atlas | estado do monitor e histórico das últimas 24 horas |
| Sentinela | estado do monitor e alertas locais |
| Sherlock | diagnóstico de anomalias públicas já registadas |
| Valida | sete contratos sintéticos locais com rede bloqueada |
| Forge | plano de investigação não aplicado a partir de Sherlock |
| Guardião | parecer técnico sobre evidências, proposta e Valida |

O gateway lê os relatórios do monitor existente em `monitorStateDir` e consulta o estado do Atlas. A Valida usa o lock e o histórico técnico do Atlas e recusa iniciar durante uma execução ativa da Sentinela. O resumo identifica data, frescura e se a fonte é histórica, local ou indisponível. Sherlock não comprova causas com simples respostas HTTP; Forge não produz patch sem causa comprovada; Guardião nunca autoriza publicação. O histórico de conversa guarda apenas ferramenta, estado, fonte e códigos, separado por bot, com no máximo 20 entradas. A mensagem original e dados pessoais não são persistidos.

## Preparação futura, sem executar nesta fase

1. Criar os seis bots pelo BotFather, escolher nomes e obter os seis tokens. Confirmar o ID numérico do utilizador e do chat privado do proprietário; ambos devem coincidir. O gateway rejeita grupos e outros utilizadores.
2. Copiar [o exemplo de configuração](agents-telegram-config.example.json) para `%LOCALAPPDATA%\Bellza\TelegramGateway\config.json`, preencher os IDs e usernames reais e confirmar `monitorStateDir`. Manter `alertsEnabled: false`. Este ficheiro fica fora do Git.
3. No perfil Windows que executará o gateway, guardar os tokens dos bots ativados com `powershell -File scripts/agents/telegram-secrets.ps1 -Mode set -Name telegram-atlas` e repetir para Sentinela. Guardar a chave OpenAI com `-Name openai-api`. Ao ativar os demais bots, guardar também os respetivos tokens. O script usa DPAPI do utilizador Windows e restringe a ACL do ficheiro. Não colocar tokens em argumentos, variáveis de ambiente, configuração ou chat.
4. Configurar uma chave da **OpenAI API** com faturação própria. A assinatura ChatGPT não fornece automaticamente acesso à API. Confirmar o preço do modelo escolhido antes de preencher os preços por milhão de tokens na configuração.
5. Antes de iniciar, confirmar que cada bot não tem webhook configurado; `getUpdates` e webhook são modos mutuamente exclusivos no Bot API. Qualquer alteração de webhook ou criação de bot real fica para autorização posterior.

## Comandos manuais futuros

Na raiz desta worktree:

```powershell
node scripts/agents/telegram-gateway.mjs status
powershell -File scripts/agents/telegram-gateway-control.ps1 -Mode start
powershell -File scripts/agents/telegram-gateway-control.ps1 -Mode status
powershell -File scripts/agents/telegram-gateway-control.ps1 -Mode stop
node --test tests/agents/phase17-telegram.test.mjs
```

`start` é manual, cria um processo oculto com logs técnicos locais em `%LOCALAPPDATA%\Bellza\TelegramGateway\gateway.*.log`. O serviço usa `gateway.lock`, recusa uma segunda instância e encerra com pedido de paragem. Se um encerramento anormal deixar um lock, verificar o PID antes de o remover manualmente. A preparação não cria inicialização automática. O exemplo ativa apenas Atlas e Sentinela; após validação manual, os outros quatro podem ser ligados um a um alterando `enabled` e adicionando os respetivos tokens. Nenhum bot é iniciado nesta fase.

## Limites e segurança

- Só o chat privado cujo `from.id` e `chat.id` correspondem ao proprietário recebe resposta. Mensagens de grupos ou desconhecidos são ignoradas.
- Ferramentas são uma lista fixa por bot. O modelo só escolhe entre elas por JSON com esquema estrito; nenhum texto recebido se torna shell, SQL, patch, deploy ou permissão.
- O monitor é consultado por ficheiros locais e a Valida executa apenas os sete testes existentes com ambiente sintético e rede negada. O gateway não consulta Supabase, Stripe ou contas de clientes.
- O adaptador usa OpenAI Responses com `store: false`, timeout de 18 segundos por chamada e máximo de 220/350 tokens de saída. São permitidas no máximo seis mensagens por minuto, 60 por dia, e a configuração limita chamadas, tokens reservados e custo diário. A reserva usa uma estimativa conservadora antes de cada chamada; pode bloquear cedo.
- Os alertas Telegram ficam desativados. A função de preparação só constrói mensagens sintéticas sem dados pessoais, com IDs de evento para deduplicação; nenhum envio automático está ligado ao monitor.
- Atualizações Telegram são marcadas como processadas antes do envio da resposta, para evitar mensagens duplicadas após falha. Uma falha de envio pode perder essa resposta; consultar o histórico local nesse caso.
- DPAPI e seis tokens não foram validados neste perfil nesta fase; não houve comunicação real com Telegram ou OpenAI. A rotação e a revogação das credenciais permanecem procedimentos manuais.

Referências oficiais: [Telegram Bot API](https://core.telegram.org/bots/api), [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [preços da API](https://developers.openai.com/api/docs/pricing).
