# Identidades QA Bellza

Projeto Supabase de produção: `pwmdzpvnatrvfpgcvnzg`. Registo técnico de 2026-11-16, sem senhas, tokens ou sessões. As contas e os estúdios QA são permanentes, mas este registo não autoriza testes funcionais nem escrita adicional.

## QA A — existente e preservado

Estúdio ativo `bellza-qa-e2663064`, ID `e2663064-7774-41c5-95cb-e5e6afc4fab4`.

| Conta Auth (ID não secreto) | Papel | Finalidade |
| --- | --- | --- |
| `96a5a309-154e-41f5-ad52-f2c52bd3bed1` | `manager` | QA de gestão |
| `9aef1eae-90b1-4ae7-9c5f-aee93abfb212` | `staff` | QA profissional |
| `ec3128b3-a366-4358-afb6-cabd41b68e79` | `studio_owner` | QA de proprietário e futura prova RLS |

As três contas estavam confirmadas, não bloqueadas e sem `saas_owner` na revisão inicial. Após a criação de QA B, os três vínculos acima continuavam presentes. Sessões atuais de QA A não foram verificadas.

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

Plano de teste futuro, sujeito a autorização: selecionar apenas `studio_id`, estado e horário em `appointments` e `booking_payment_requests` numa janela de 30 minutos, primeiro para estúdio próprio e depois cruzado. Registar apenas contagens e decisões de acesso, sem dados pessoais. Sem linhas adequadas, classificar o isolamento da tabela como **INDETERMINADO**. Não ativar a API privada automaticamente.

Para reversão ou suspensão, verificar antes dependências da conta e do estúdio. Não apagar nem desativar automaticamente estas identidades permanentes. Qualquer alteração posterior de Auth, estúdio, papéis, dados ou políticas requer autorização específica.
