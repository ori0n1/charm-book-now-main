# Decisão proposta da fonte de migrations — sem consolidação

Nenhum ficheiro foi movido, renomeado, apagado ou aplicado nesta análise.

## Inventário forense

| Diretório              | Quantidade | Intervalo nominal                                      |   Bytes | SHA-256 do manifesto ordenado                                      |
| ---------------------- | ---------: | ------------------------------------------------------ | ------: | ------------------------------------------------------------------ |
| `supabase/migrations/` |        143 | `20260512115441` → `20260923213000`                    | 755.679 | `24a212375c457caa62ac70290d2d1ddd765a6768de72410098fec9d33ab82e6e` |
| `migrations/`          |          3 | um prefixo de 8 dígitos e dois ficheiros sem timestamp |  11.318 | `7f85d597e0947e9cedb98647a305dd5c31028c1f981ed538ad3b7599c68fab77` |

O hash do manifesto é calculado sobre linhas ordenadas
`<nome> <sha256-do-conteúdo>`, separadas por LF.

| Ficheiro legado                             | SHA-256                                                            | Análise                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260705_restore_14_day_premium_trial.sql` | `09d5202f1729c29d8189983711b723aeafb88aa889473893ba4ee52988db8367` | altera defaults/funções e atualiza studios existentes; sobrepõe áreas depois alteradas pela cadeia oficial                                          |
| `referrals.sql`                             | `f11a131ee24f35505f852c9c750e23579675cd6a370ca0044bf0198972c11d7a` | cria referrals entre estúdios; não é a mesma feature que `customer_referrals`; migrations oficiais posteriores assumem `public.referrals` existente |
| `stripe_connect_studios.sql`                | `cd35fff319aca31879bf00128dcf5d63f6543b972143ec2875e4f35524063fe3` | cria estado Connect no studio, mas documenta Express; o modelo atual é Standard/full e migrations posteriores dependem das colunas                  |

Não há interseção de nomes nem hashes de conteúdo idênticos entre os dois
diretórios. Há sobreposição semântica e dependências históricas, portanto
“apagar os três ficheiros porque não são duplicatas exatas” seria inseguro.

## Referências e histórico

- O Supabase CLI usa `supabase/migrations/` relativamente ao
  `supabase/config.toml`; o diretório raiz `migrations/` não participa de
  `db push`, `migration list` ou replay padrão.
- Documentação recente referencia explicitamente migrations sob
  `supabase/migrations/`.
- Nenhum script ou package script referencia os três ficheiros legados.
- Não existe `.github/workflows`; não há CI/CD que selecione qualquer diretório.
- Os três ficheiros raiz entraram juntos no commit-snapshot `e24c6ac`. Já
  `supabase/migrations/` possui histórico contínuo por migration; 104 ficheiros
  estão no índice Git atual e 39 são candidatos ainda não commitados.

## Fonte oficial proposta

`supabase/migrations/` deve ser a única fonte operacional oficial porque é a
convenção efetivamente consumida pelo CLI e contém a sequência cronológica
mantida. Esta é uma decisão proposta, não uma consolidação concluída.

O histórico real esperado da Bellza ainda é a união de:

1. migrations versionadas em `supabase/migrations/`;
2. efeitos dos três scripts legados aplicados fora dessa árvore;
3. baseline e fixture exclusivos do staging documentados no ledger.

Consequentemente, a árvore oficial ainda não é um replay autónomo e não deve
ser aplicada cegamente.

## Plano seguro de consolidação

1. Congelar este inventário e recuperar evidência de quando/onde cada script
   legado foi aplicado.
2. Comparar os objetos afetados com um clone descartável representativo, sem
   usar produção.
3. Para cada efeito legado ainda necessário, criar uma migration de ponte
   nova, idempotente e versionada em `supabase/migrations/`; não copiar SQL
   antigo que contenha DML destrutivo ou semântica Express obsoleta.
4. Testar replay baseline + ponte + cadeia posterior e comparar schema/hashes.
5. Reconciliar o ledger staging somente depois, em etapa separada e autorizada.
6. Após comprovação, arquivar `migrations/` como evidência histórica e adicionar
   CI que rejeite novos `.sql` fora de `supabase/migrations/`.

Nenhum passo de consolidação foi executado nesta etapa.
