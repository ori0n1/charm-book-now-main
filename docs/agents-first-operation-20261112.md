# Primeira operação integrada Bellza — 12/11/2026

Execução local na worktree isolada derivada de `14a66d8`. Nenhum patch foi
aplicado e nenhuma escrita remota foi realizada.

| Modo | Fluxo | Anomalia | Causa | Proposta | Valida | Guardião |
| --- | --- | --- | --- | --- | --- | --- |
| Sintético | `6463b603-0368-45b2-b515-e4a412f6852e` | `OFFICIAL_RECORD_OUTDATED` fictícia | `CONFIRMADA` apenas pela prova sintética ligada ao mesmo fluxo | `agents/reference.json`, não aplicada | `APPROVED`, sete contratos locais | `APTO` para revisão local |
| Leitura real | `b2e75393-4398-4b8f-bb62-84c4237f1372` | `OFFICIAL_RECORD_OUTDATED` no manifesto; leituras Cloudflare e endpoints bloqueadas por `NETWORK_UNAVAILABLE`/`PUBLIC_ENDPOINT_READ_BLOCKED` | `NAO_DETERMINADA` | Nenhuma | `APPROVED`, sete contratos locais | `INDETERMINADO` |

O modo sintético usou versões fictícias e respostas em memória; o resultado
`APTO` não é evidência da produção. No modo real, a indisponibilidade de rede
impediu confirmar a versão ativa. Não foi identificada uma causa de produção
comprovada nem foi autorizada correção ou publicação. O próximo passo é
repetir a leitura autorizada quando a rede estiver disponível.

Os relatórios completos, com IDs de cada etapa e dependências, ficam em
`.bellza-agent-state/flows/<flowId>.md` nesta worktree. Esses artefactos
locais são ignorados pelo Git. Os testes automatizados da equipa passaram
`23/23` e os cenários da fase integrada passaram `5/5`.
