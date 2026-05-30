# Painel do estúdio — melhorias

Implementação em uma única sequência, do mais arriscado (auth/sessão) para o mais cosmético.

## 1. Sessão e carregamento (bug crítico)

Causas prováveis:
- `onAuthStateChange` no `__root.tsx` chama `router.invalidate()` + `queryClient.invalidateQueries()` em TODO evento (incluindo `TOKEN_REFRESHED` a cada ~1h e `INITIAL_SESSION`), o que reinicia loaders e dá a sensação de "página atualizando sozinha".
- O layout `_authenticated/admin.tsx` faz `navigate({ to: "/onboarding" })` se `user_roles` vier vazio — em re-renders rápidos pode disparar antes da query terminar.

Correções:
- Filtrar `onAuthStateChange` para invalidar só em `SIGNED_IN` e `SIGNED_OUT` (ignorar `TOKEN_REFRESHED`, `INITIAL_SESSION`, `USER_UPDATED`).
- Guardar `loading` real no admin layout antes de redirecionar para onboarding.
- Memoizar a query do studio com `useRef`/flag para não disparar duas vezes no Strict Mode.

## 2. Auth — remover Google, manter confirmação por link

- Remover botões "Entrar/Criar com Google" de `login.tsx` e `signup.tsx`.
- Manter `signUp` com `emailRedirectTo` (link de confirmação).
- Garantir que `auto_confirm_email = false` via `configure_auth` para que a conta só ative após clicar no link.
- Tratar erro `email_not_confirmed` no login com mensagem clara: "Confirme o seu email antes de entrar."
- Adicionar botão "Reenviar email de confirmação" na tela de login quando esse erro aparecer.

## 3. Tema claro/escuro

- Criar `ThemeProvider` em `src/components/theme-provider.tsx` com persistência em `localStorage` (`lumiere:theme`) + classe `dark` no `<html>`.
- Toggle (Sol/Lua) no sidebar do `_authenticated/admin.tsx` e no header mobile.
- Já existe `.dark { ... }` em `styles.css` — apenas refinar contraste do tema claro (escurecer borders, intensificar `muted-foreground`).

## 4. Design e contraste (tema claro)

Ajustes em `src/styles.css` apenas (não toca componentes):
- `--border`: de `0.08` para `0.14` de opacidade.
- `--muted-foreground`: mais escuro (`0.42` em vez de `0.55`).
- `--surface`: leve diferenciação do `background`.
- `--card`: sombra sutil via novo token `--shadow-card`.

## 5. Categorias — lista global de sugestões + criação custom

- Migração: criar tabela `service_category_suggestions` (id, label, sort_order, is_active) com seed de ~12 categorias comuns (Cabelo, Unhas, Estética facial, Massagem, Sobrancelhas, Cílios, Maquilhagem, Depilação, Pedicure, Manicure, Coloração, Tratamentos).
  - RLS: leitura pública (`anon, authenticated`), escrita bloqueada.
- Em `admin.servicos.tsx`: ao abrir o seletor de categoria, listar as do estúdio + sugestões globais ainda não importadas, com botão "Usar esta sugestão" (cria em `service_categories` no momento) e botão "+ Nova categoria" para criar uma personalizada via input inline.

## 6. Carrossel de fotos dos serviços

- Em `admin.servicos.tsx` (ou no componente que renderiza a media): adicionar botões `<ChevronLeft />` e `<ChevronRight />` posicionados absolutos sobre as bordas das fotos.
- Manter `onKeyDown` existente.
- Adicionar suporte a swipe touch com `onTouchStart`/`onTouchEnd` (delta > 50px).

## 7. Labels de imagem do estúdio

- Em `admin.marca.tsx`: trocar texto "Banner" → "Foto principal", adicionar legenda "Imagem grande de destaque mostrada no topo da página pública do estúdio" e na logo "Logótipo — ícone pequeno do estúdio (exibido no menu e cabeçalho)".

## Detalhes técnicos

- Schema: 1 migração nova (`service_category_suggestions` + seed).
- Arquivos novos: `src/components/theme-provider.tsx`, `src/components/theme-toggle.tsx`.
- Arquivos editados: `__root.tsx`, `start.ts` (envolver com ThemeProvider), `styles.css`, `login.tsx`, `signup.tsx`, `_authenticated/admin.tsx`, `_authenticated/admin.index.tsx`, `_authenticated/admin.servicos.tsx`, `_authenticated/admin.marca.tsx`.
- Sem alteração em booking público, pagamentos, agenda, equipa, horários.

## Fora de escopo

- OTP de 6 dígitos (mantido link, conforme escolha).
- Reescrita visual completa (apenas refino de contraste).
