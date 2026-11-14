# Correção local e Guardião interno

Base: `b8b5b07`. O gateway Telegram, as tarefas Windows e a aplicação Bellza não usam esta worktree.

`runLocalCorrectionFlow`, exportado pelo Atlas, reutiliza Sherlock, Forge e Valida e chama o Guardião internamente. Regista ID, dependências e parecer no histórico local do Atlas. A única receita de escrita disponível é `agents/reference.json`: Forge exige diagnóstico único e comprovado de `OFFICIAL_RECORD_OUTDATED`, versões ligadas à mesma execução, commit de origem comprovado e checkout limpo. Cria uma **nova worktree**, aplica ali a alteração mínima à referência e deixa o checkout de origem intocado. Valida verifica três contratos dirigidos sobre a diferença Git e o JSON alterado; não executa código dessa worktree. A suíte de regressão dos agentes corre separadamente na candidata. O Guardião verifica a cadeia de evidências, escopo, teste, comparação com a versão ativa e rollback; devolve `APTO`, `BLOQUEADO` ou `INDETERMINADO` para a **proposta local**. Todos os campos de autorização de canário, promoção e publicação permanecem falsos.

Esta receita não corrige código de agenda ou reservas. Para esses casos, Sherlock precisa primeiro de causa real comprovada por leitura RLS autorizada e correspondência com a base ativa; depois é necessária uma receita mínima específica com testes de regressão. Uma hipótese ou fixture nunca autoriza patch de produção.

Verificação sintética:

```powershell
node --test tests/agents/local-correction-flow.test.mjs tests/agents/phase3.test.mjs tests/agents/phase4.test.mjs
```

O teste cria um repositório e uma worktree temporários, altera uma referência fictícia **somente na worktree**, verifica os contratos dirigidos e confirma que o Guardião não autoriza publicação. Um ficheiro de teste hostil na fixture não é executado. Não usa Telegram, Supabase, Cloudflare, staging ou credenciais.

Próximo passo técnico: ligar apenas artefactos de diagnóstico e prova de origem validados ao fluxo manual. Guardião pode funcionar internamente sem bot Telegram. Qualquer integração no gateway ativo, alteração de permissões Supabase ou preparação de deploy requer autorização específica posterior.
