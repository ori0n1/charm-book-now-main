# STAGING ONLY — Cloudflare deploy safety

Produção, DNS, routes e custom domains não são autorizados por este fluxo.

## Estado fail-closed

O alvo raiz de `wrangler.jsonc` é `bellza-deploy-blocked`, com
`workers_dev=false`, `routes=[]` e `crons=[]`. Não existe configuração
executável do Worker de produção no alvo padrão.

Todo deploy que use esse ficheiro chama, antes do upload,
`scripts/block-unsafe-wrangler-deploy.mjs`. O hook exige simultaneamente:

- `CLOUDFLARE_DEPLOY_ENVIRONMENT=staging`;
- `CLOUDFLARE_ENV=staging`;
- `EXPECTED_CLOUDFLARE_WORKER_NAME=tanstack-start-app-staging`;
- `CLOUDFLARE_WORKER_NAME=tanstack-start-app-staging`;
- Account ID com o fingerprint da conta Bellza já auditada;
- Account API Token no formato esperado.

Antes de permitir chegar ao upload, o hook faz somente duas leituras na API:
verifica que o token está ativo e exige que a enumeração de Workers visíveis
contenha exatamente `tanstack-start-app-staging`. Acesso ausente, conta errada,
Worker divergente ou visibilidade de qualquer Worker adicional abortam.

Não são consultados nem alterados Zone, DNS, routes, custom domains ou o Worker
de produção.

## Redirecionamento criado pelo plugin Vite

O plugin Cloudflare/Vite cria `.wrangler/deploy/config.json`, que faz um
`wrangler deploy` ignorar o ficheiro raiz e reutilizar o último artefato. Esse
bypass foi identificado durante o dry-run.

Os wrappers `scripts/build-safe.mjs` e `scripts/build-staging.mjs` agora removem
esse redirecionamento antes e depois do build. O preflight também aborta se o
ficheiro reaparecer. `.wrangler/` permanece fora do Git.

## Comandos suportados

O repositório oferece somente preflight e testes:

```text
npm run guard:cloudflare:staging
npm run test:cloudflare:guard
```

Não foi criado script de deploy nem fluxo de produção. Quando um deploy staging
for futuramente autorizado, a invocação deve selecionar explicitamente
`--env staging --name tanstack-start-app-staging`, sem flags de routes, domains
ou schedules, e passar pelo hook acima.
