# Identidades QA Bellza

Projeto Supabase de produção: `pwmdzpvnatrvfpgcvnzg`. Registo técnico de 2026-11-16, sem senhas, tokens ou sessões. As contas e os estúdios QA são permanentes, mas este registo não autoriza testes funcionais nem escrita adicional.

## QA A — existente e preservado

Estúdio ativo `bellza-qa-e2663064`, ID `e2663064-7774-41c5-95cb-e5e6afc4fab4`. Em 2026-11-16, `is_active=true`, `plan_tier=premium`, `subscription_status=trialing` e `trial_ends_at=2026-11-08T23:16:15Z`; o prazo de trial registado já passou. Nenhum campo de QA A foi alterado.

| Conta Auth (ID não secreto) | Papel | Finalidade |
| --- | --- | --- |
| `96a5a309-154e-41f5-ad52-f2c52bd3bed1` | `manager` | QA de gestão |
| `9aef1eae-90b1-4ae7-9c5f-aee93abfb212` | `staff` | QA profissional |
| `ec3128b3-a366-4358-afb6-cabd41b68e79` | `studio_owner` | QA de proprietário e futura prova RLS |

Emails QA A confirmados no catálogo Auth: `qa-manager-20261025@bellza.invalid`, `qa-professional-20261025@bellza.invalid` e `qa-owner-20261025@bellza.invalid`, respetivamente. O email do profissional foi reconfirmado no Auth em 2026-11-21; o registo anterior em português estava incorreto.

As três contas estavam confirmadas, não bloqueadas e sem `saas_owner` na revisão inicial. Após a criação de QA B, os três vínculos acima continuavam presentes. As sessões do proprietário e profissional QA A foram verificadas em 2026-11-21.

## QA B — criado e inativo

| Campo | Estado comprovado |
| --- | --- |
| Conta Auth | `qa-owner-b-20261116@bellza.invalid` |
| ID da conta | `900acc24-5759-4571-a5d9-01588406f84d` |
| Autenticação | Conta confirmada, não bloqueada; criada pela interface oficial do Supabase Auth sem convite por email |
| Perfil | Uma linha criada pelo gatilho de Auth |
| Estúdio | `Bellza QA B`, slug `bellza-qa-b`, ID `2cc1683e-ab91-4488-a702-6a8feb60f379` |
| Estado do estúdio | `is_active=false`, `plan_tier='free'`, `subscription_status='canceled'`, `trial_ends_at='2000-01-01T00:00:00Z'` |
| Papel | Um único vínculo `studio_owner` com QA B; nenhum outro vínculo da conta |
| WhatsApp | Um entitlement `inactive`; zero claims de trial |
| Finalidade | Testes QA futuros de RLS, agenda e reservas com autorização específica |

O proprietário definiu a senha diretamente no formulário do navegador e informou que a guardou. A Codex não recebeu, leu nem armazenou a senha. Não colocar senha, JWT, refresh token ou sessão no Git, logs, Telegram ou gateway.

A conta Auth foi criada pelo formulário `Create new user` do Dashboard, com confirmação automática e indicação na interface de que não seria enviado email. O estúdio e o vínculo foram criados numa única transação SQL especificamente autorizada, com pré-condições de identidade, ausência de conflitos e papel, mais verificações transacionais do estado inativo e do entitlement. A transação terminou sem erro. Uma consulta posterior, somente de contagens e estados, confirmou: Auth=1, perfil=1, estúdio inativo=1, vínculo `studio_owner`=1, vínculos totais da conta=1, entitlement inativo=1, claims de trial=0, vínculos QA A preservados=3.

O estúdio `teste` não foi usado porque tinha um vínculo com utilizador sem marcador QA. Studio 27, Capivara e demais estúdios reais não foram alterados. Não foram consultadas agenda nem reservas nesta criação.

## Reutilização e limites

As duas identidades `studio_owner` para uma futura prova RLS são QA A `ec3128b3-a366-4358-afb6-cabd41b68e79` e QA B `900acc24-5759-4571-a5d9-01588406f84d`. Devem autenticar-se legitimamente em sessões separadas, sob controlo do proprietário; nenhuma sessão pessoal pode ser guardada no gateway automático.

QA B permanece inativo. A implementação local revista sugere que a RLS funcional exige estúdio ativo, mas a correspondência exata com o Worker em produção não foi revista nesta operação. A ativação de QA B, qualquer criação de dados sintéticos e os GETs reais de agenda e reservas exigem análise e autorização específicas. Sem esses testes, o isolamento RLS real entre QA A e QA B continua **não comprovado**.

### Decisão sobre ativação em 2026-11-16

A autorização atual condiciona a ativação de QA B à ausência de publicação pública ou outros efeitos fora do escopo. **QA B não foi ativado.** A leitura administrativa confirmou `is_active=false` para QA B e `true` para QA A. A análise de código local identificou os caminhos de sitemap, página e manifesto; a verificação da exposição na versão ativa encontra-se na secção seguinte.

Na instância de produção, há seis triggers não internos em `public.studios`. As definições e os corpos relevantes para `is_active` foram revistos; o resultado encontra-se na secção seguinte. Nenhuma atualização de estúdio foi executada.

### Proteção pública proposta em 2026-11-16 — ainda não publicada

Uma sessão anónima no navegador confirmou que `/sitemap.xml` enumera QA A e que `/s/bellza-qa-e2663064` abre a página pública. QA B devolve 404 enquanto inativo. A revisão de metadados de produção confirmou que `public.public_studios` admite `SELECT` de `anon` e usa `private.catalog_public_studios()`, que inclui estúdios ativos com `public_page`, sem excluir QA. `public.studio_has_entitlement` concede `public_page` também a estúdios ativos gratuitos. Assim, mudar apenas `is_active` de QA B expô-lo-ia na origem pública.

O candidato local exclui explicitamente QA A e QA B do sitemap, página de estúdio, manifesto e entradas de reserva pública. Outras cinco funções `private.catalog_public_*` expõem serviços, equipa, categorias, relações e ofertas de estúdios ativos. Todas as seis são `STABLE SECURITY DEFINER`, e as seis vistas correspondentes permitem `SELECT` a `anon`. `docs/qa-public-catalog-proposal.sql` prepara a exclusão nas seis funções, preservando os restantes estúdios; **não foi executado**. A versão publicada da aplicação não foi alterada. A ativação de QA B exige aprovação separada para a correção da base e da aplicação, validação dos pontos públicos restantes e, depois, aprovação específica para mudar apenas `is_active` de QA B. Estes bloqueios não afetam os fluxos administrativos QA autenticados.

Os corpos dos triggers de `studios.is_active` foram lidos: a proteção de campos de plano não modifica o estado; a proteção de campos da plataforma impede essa mudança por `anon` e `authenticated`; os dois triggers de `set_updated_at` atualizam o timestamp. O trigger de entitlement WhatsApp é apenas de INSERT; o de evento de plano só reage a colunas de plano/subscrição. Não foi observada cobrança, notificação ou trial nesses corpos para um UPDATE exclusivo de `is_active`. Nenhum UPDATE foi executado.

Reversão da proposta local: descartar o commit candidato. Se a correção vier a ser publicada, uma reversão da função exigiria autorização própria e recolocaria QA A na vista pública; primeiro seria necessário desativar QA A com autorização ou manter proteção equivalente. Reverter só a aplicação também reexporia QA A. QA B permanece inativo até confirmação em produção de todos os filtros.

### Autenticação local preparada

O ficheiro `scripts/agents/qa-vault.ps1` usa DPAPI do utilizador Windows e ACL do próprio utilizador num diretório separado de Telegram, em `%LOCALAPPDATA%\Bellza\QA\secrets`. O autoteste com um segredo sintético temporário passou no perfil Windows efetivo. As três senhas QA e a chave pública estão guardadas nesse cofre. O proprietário deve manter futuras credenciais exclusivamente nele, sem as transmitir à Codex.

Comandos manuais no PowerShell do proprietário, nesta worktree:

```powershell
pwsh -NoProfile -File scripts/agents/qa-vault.ps1 -Mode set -Name qa-a-password
pwsh -NoProfile -File scripts/agents/qa-vault.ps1 -Mode set -Name qa-b-password
pwsh -NoProfile -File scripts/agents/qa-vault.ps1 -Mode set -Name publishable-key
pwsh -NoProfile -File scripts/agents/qa-vault.ps1 -Mode status -Name qa-b-password
pwsh -NoProfile -File scripts/agents/qa-vault.ps1 -Mode run -Studio STUDIO_QA_B -Operation auth-check
```

Em 2026-11-21, o Auth confirmou novamente os IDs, emails, marcadores QA, contas confirmadas e ausência de bloqueio do proprietário QA A e do profissional QA A. Com autorização específica do proprietário, apenas as senhas dessas duas contas sintéticas foram redefinidas pelo Auth Admin oficial e guardadas diretamente no DPAPI com ACL privada. QA B não foi alterada. As três contas autenticaram pelo cofre e fizeram leituras HEAD com JWT autenticado; QA B não viu as duas reservas visíveis ao proprietário QA A. O profissional QA A viu uma reserva própria. Isto comprova isolamento de leitura observado, não autoriza escrita em produção nem comprova a RPC candidata ainda não publicada.

O `auth-check` usa o endpoint oficial Supabase Auth de senha e valida o ID esperado da identidade no endpoint Auth `/user`; não lê tabelas de negócio. O JWT só existe na memória do processo curto. Cada execução autentica de novo, sem guardar refresh token. Rotação local: `-Mode rotate -Name <nome>`; revogação local: `-Mode revoke -Name <nome>`. A revogação do ficheiro local **não** invalida senhas ou sessões no servidor; rotação/bloqueio no Supabase Auth requer autorização administrativa específica. Nunca colocar a senha ou token em argumentos de comando, no Git, no gateway Telegram ou em prompts da IA.

`agents/qa/read-executor.mjs` aceita somente `STUDIO_QA_A` e `STUDIO_QA_B`, com operações fixas `agenda` e `reservas`; não expõe SQL, shell ou escrita. Há limite de 2,5 segundos e bloqueio de concorrência por estúdio. Atlas, Sherlock e Valida poderão chamar este executor por ferramentas locais explícitas, recebendo apenas métricas agregadas. **O executor real está desligado** (`enableLiveRead=false`) e não foi ligado aos agentes ativos ou às tarefas Windows. A identidade `studio_owner` pode ter permissões de escrita no projeto: o filtro de código limita operações do executor, mas não torna a credencial intrinsecamente somente de leitura. A ativação automática exige prova RLS e revisão dessa separação de privilégios.

Níveis de autorização: **1**, autenticação e leituras QA sem efeitos externos após validação de RLS; **2**, qualquer criação, alteração ou limpeza de dados sintéticos, mediante aprovação específica; **3**, pagamentos reais, mensagens externas, alterações globais ou possível impacto em estúdios reais, mediante aprovação explícita separada. O nível 1 não autoriza os níveis 2 ou 3.

Plano de teste futuro, sujeito a autorização: selecionar apenas `studio_id`, estado e horário em `appointments` e `booking_payment_requests` numa janela de 30 minutos, primeiro para estúdio próprio e depois cruzado. Registar apenas contagens e decisões de acesso, sem dados pessoais. Sem linhas adequadas, classificar o isolamento da tabela como **INDETERMINADO**. Não ativar a API privada automaticamente.

Para reversão ou suspensão, verificar antes dependências da conta e do estúdio. Não apagar nem desativar automaticamente estas identidades permanentes. Qualquer alteração posterior de Auth, estúdio, papéis, dados ou políticas requer autorização específica.
