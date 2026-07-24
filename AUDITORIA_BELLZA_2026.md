# Relatório de Auditoria Técnica — Bellza Plataforma
**Data:** 13 de junho de 2026  
**Stack:** React 19 · TanStack Start · Cloudflare Workers · Supabase · Stripe · Send.dm WhatsApp  

---

## Veredicto Final

### ⚠️ Pronto com Restrições

A plataforma está funcionalmente completa e com os fluxos críticos de pagamento protegidos. Os problemas de segurança mais graves foram corrigidos nesta auditoria. Recomenda-se lançamento beta controlado (10–50 estúdios) enquanto os itens de RGPD pendentes são implementados.

---

## Correções Implementadas Nesta Auditoria

| # | Ficheiro | Correção |
|---|---|---|
| 1 | `src/routes/auth.debug.tsx` | Redireciona para `/` em produção (`import.meta.env.PROD`) |
| 2 | `src/integrations/supabase/client.ts` | `debugFetch` global desativado em produção |
| 3 | `src/lib/stripe.server.ts` | Webhook HMAC com timing-safe comparison via `crypto.subtle.verify` |
| 4 | `src/lib/stripe-connect.functions.ts` | Lança erro se `STRIPE_ENV !== "live"` (consistente com payments) |
| 5 | `src/lib/whatsapp.functions.ts` | Fallback URL corrigido: `localhost:8081` → `https://www.bellza.pt` |
| 6 | `src/lib/whatsapp.functions.ts` | Mensagem técnica de erro de schema substituída por mensagem de utilizador |
| 7 | `src/routes/_authenticated/admin.agenda.tsx` | Textos sem acentos corrigidos: Amanha→Amanhã, Proximos→Próximos, Faturacao→Faturação, Marcacoes→Marcações, Avancados→Avançados, "Fora do Sandbox"→"Número não autorizado" |

---

## Problemas Encontrados por Criticidade

### 🔴 CRÍTICO — Resolvidos

**[C1] Página /auth/debug pública em produção**  
- Ficheiro: `src/routes/auth.debug.tsx`  
- Exposição de estado de sessão, configuração de ambiente e 120 eventos de debug a qualquer visitante.  
- ✅ **Corrigido:** redirect para `/` quando `import.meta.env.PROD`

**[C2] debugFetch global ativo em produção**  
- Ficheiro: `src/integrations/supabase/client.ts:35`  
- Intercetava todos os `fetch()` do browser em produção, com overhead de performance e dados de sessão em localStorage.  
- ✅ **Corrigido:** restrito a `import.meta.env.DEV`

**[C3] Credenciais Supabase hardcoded no client.ts**  
- Ficheiro: `src/integrations/supabase/client.ts:5-6`  
- A `publishableKey` (anon key) está hardcoded. É uma chave pública por design (Supabase) — não é um secret — mas a sua exposição no bundle depende da RLS estar correta.  
- ⚠️ **Risco residual:** Se a RLS do Supabase não estiver ativa em todas as tabelas, qualquer pessoa pode consultar dados via API Supabase com a anon key. Verificar RLS nas tabelas: `studios`, `clients`, `appointments`, `payment_intents`, `staff`, `user_roles`.

---

### 🟠 ALTO — Resolvidos ou Documentados

**[A1] Webhook Stripe sem timing-safe comparison**  
- Ficheiro: `src/lib/stripe.server.ts:69`  
- `Array.includes()` não é timing-safe para comparação HMAC.  
- ✅ **Corrigido:** usa `crypto.subtle.verify()` para comparação timing-safe

**[A2] stripe-connect.functions.ts inconsistente com payments.functions.ts**  
- Ficheiro: `src/lib/stripe-connect.functions.ts:20`  
- Connect usava `sandbox` quando `STRIPE_ENV` não definido; payments lançava erro. Risco de mistura sandbox/live.  
- ✅ **Corrigido:** lança erro se `STRIPE_ENV !== "live"`

**[A3] Verificação de reembolso sem confirmar no Stripe**  
- Ficheiro: `src/lib/refund-operations.functions.ts:100-141`  
- `markRefundCompleted` aceita `stripeRefundId` sem verificar via API Stripe se o reembolso foi processado.  
- ⚠️ **Pendente:** Adicionar `stripe.refunds.retrieve(stripeRefundId)` e verificar `status === "succeeded"` antes de marcar como refunded.

**[A4] SSR skip na verificação de autenticação**  
- Ficheiro: `src/routes/_authenticated.tsx:8-9`  
- `if (typeof window === "undefined") return;` ignora autenticação no SSR.  
- ⚠️ **Risco mitigado:** As server functions individuais têm `requireSupabaseAuth`. Dados sensíveis não são expostos no SSR sem token válido.

**[A5] RGPD — Direito ao esquecimento não implementado**  
- Não existe endpoint ou interface de auto-eliminação de conta.  
- ⚠️ **Pendente:** Documentar processo manual interno com SLA de 30 dias. Implementar endpoint no próximo sprint.

**[A6] RGPD — Portabilidade de dados não implementada**  
- Não existe exportação de dados pessoais para o cliente final (Art. 20 RGPD).  
- ⚠️ **Pendente:** Implementar endpoint de exportação ou documentar processo manual.

---

### 🟡 MÉDIO — Documentados

**[M1] Rate limiting ineficaz em multi-instance**  
- Ficheiro: `src/lib/server-security.ts:23`  
- O rate limiter in-memory (Map) não é partilhado entre instâncias Cloudflare Workers.  
- Solução: Depender exclusivamente do rate limit via Supabase RPC (já implementado como fallback).

**[M2] Banner de consentimento de cookies ausente**  
- A Política de Cookies menciona um banner mas não existe implementação.  
- Solução: Implementar CookieYes, Klaro ou equivalente antes de ativar analytics/marketing.

**[M3] minBookingNoticeMin filtrado no cliente**  
- Ficheiro: `src/lib/availability.ts:18-33`  
- Um utilizador técnico pode obter slots sem o filtro de aviso mínimo via chamada direta à RPC.  
- Solução: Mover filtro para dentro da stored procedure `get_available_slots`.

**[M4] Race condition em créditos de indicação**  
- Ficheiro: `src/lib/referrals.functions.ts:313-323`  
- Crédito Stripe criado antes do insert na BD — se o insert falhar, o crédito fica "perdido".  
- Solução: Inverter a ordem (BD primeiro, depois Stripe).

**[M5] OR clause em query de payment intent**  
- Ficheiro: `src/lib/payments.functions.ts:122`  
- `.or(stripe_payment_intent_id.is.null)` pode associar payment intent a reserva incorreta em race condition.  
- Solução: Remover a cláusula `.is.null` do OR.

**[M6] Política de Privacidade sem identificação de subcontratantes**  
- Stripe, Send.dm, Supabase, Cloudflare não são nomeados explicitamente.  
- Solução: Atualizar `src/routes/privacidade.tsx` com lista de subcontratantes.

---

### 🔵 BAIXO — Documentados

**[B1] Números de telefone de clientes em logs de Workers**  
- Ficheiro: `src/lib/whatsapp.functions.ts:220-228`  
- Logs de envio incluem número completo (`to: recipient`).  
- Solução: Mascarar: `+351 *** *** 78`

**[B2] Webhook com query param ?env desnecessário**  
- Ficheiro: webhook handler  
- Superfície desnecessária. Solução: remover o query param.

**[B3] console.info em código de disponibilidade em produção**  
- Ficheiro: `src/lib/availability.ts:20-26`  
- Logs excessivos com studioSlug, staffId, date em cada chamada.  
- Solução: Remover ou condicionar a `DEBUG=true`.

---

## O Que Está Correto ✅

- **Idempotência de pagamentos Stripe** — chaves de idempotência corretas em todos os fluxos
- **Autenticação server-side** — Bearer token + JWT validation em todas as server functions protegidas
- **Proteção de funções admin** — `assertSaasOwner()` em todas as operações sensíveis (reembolsos, métricas, levantamentos)
- **Proteção de autoindicação** — `self-referral` bloqueado por código e constraint BD
- **Créditos de indicação não convertíveis em dinheiro** — crédito Stripe Balance apenas (não transferível)
- **PCI DSS compliant** — nenhum dado de cartão armazenado localmente (apenas IDs Stripe)
- **Stripe LIVE enforced** — pagamentos lançam erro se `STRIPE_ENV !== "live"`
- **Conflitos de horário** — delegados à BD via stored procedures (atómico)
- **Isolamento de dados admin** — todas as funções saas_owner verificam role no servidor
- **WhatsApp LIVE** — migração completa do Sandbox para +18144822194
- **Reembolsos com aprovação** — fluxo manual com dupla validação (estúdio + Bellza)

---

## Checklist de Lançamento

### Antes do lançamento público (obrigatório)
- [x] /auth/debug protegido em produção
- [x] debugFetch desativado em produção
- [x] Webhook HMAC timing-safe
- [x] Stripe Connect consistente com Live
- [ ] **Verificar RLS ativa em todas as tabelas Supabase** (manual — Supabase dashboard)
- [ ] **Implementar banner de consentimento de cookies**
- [ ] **Documentar processo de direito ao esquecimento**

### Sprint seguinte (alta prioridade)
- [ ] Verificar reembolso via Stripe API antes de marcar como concluído
- [ ] Mover minBookingNoticeMin para stored procedure
- [ ] Corrigir race condition em créditos de indicação
- [ ] Atualizar Política de Privacidade com subcontratantes
- [ ] Portabilidade de dados RGPD

### Manutenção contínua
- [ ] Mascarar números de telefone em logs de produção
- [ ] Remover console.info de availability.ts
- [ ] Remover query param ?env do webhook

---

## Riscos Remanescentes

| Risco | Probabilidade | Impacto | Mitigação Atual |
|---|---|---|---|
| RLS Supabase incompleta | Médio | Alto | Anon key pública — verificar dashboard |
| Reembolso não verificado no Stripe | Baixo | Alto | Processo manual com dupla aprovação |
| Race condition indicações | Baixo | Médio | UNIQUE constraint na BD protege duplicados |
| Rate limiting multi-instance | Médio | Médio | Fallback Supabase durable existe |
| RGPD direito ao esquecimento | Médio | Alto | Processo manual documentado necessário |
