# AGENTS.md

## Playwright

Este projeto usa Playwright com TypeScript e testes na pasta `tests/`.

Comandos principais:

```bash
npm run test:e2e
```

Executa todos os testes end-to-end configurados.

```bash
npm run test:e2e:chromium
```

Executa apenas no Chromium. Use este comando para uma verificação rápida local.

```bash
npm run test:e2e:ui
```

Abre o modo interativo do Playwright.

Para instalar ou atualizar navegadores e dependências:

```bash
npx playwright install --with-deps
```

A configuração está em `playwright.config.ts`. O Playwright sobe o app automaticamente com `npm run dev -- --host 127.0.0.1 --port 4178` e usa `http://127.0.0.1:4178` como `baseURL`.

Nota para Windows PowerShell: se `npm` for bloqueado pela política de execução de scripts, use `npm.cmd` no lugar de `npm`, por exemplo:

```bash
npm.cmd run test:e2e:chromium
```
