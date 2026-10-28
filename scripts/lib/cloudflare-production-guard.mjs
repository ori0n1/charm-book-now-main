import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoWranglerDeployRedirect } from './wrangler-deploy-redirect.mjs';

export const PRODUCTION_WORKER = 'tanstack-start-app';
export const PRODUCTION_ACCOUNT = '5c4cb61495df81feda4da7d1098e098e';
export const PRODUCTION_PROJECT = 'pwmdzpvnatrvfpgcvnzg';
export const PRODUCTION_ROLLBACK = 'f1821f91-4613-4620-a4e3-ee0fa7bb2506';
export const PRODUCTION_ROLLBACK_MESSAGE = 'Google Places candidate SHA256=e4d41f249a29d9289685090f9d5d7847daff892d8eb05a99840bd3853714a56e';
export const PRODUCTION_ROLLBACK_ETAG = '310e333980a630ece40d1b28e5bf4f8537e5bc8e98735098b0b69b5c487f52d3';
export const PRODUCTION_BASE_COMMIT = 'd58f4cda5caefa8ba8bcc9f2b28aeb74712e9c17';
export const PRODUCTION_HOOK = 'node scripts/block-unsafe-wrangler-deploy.mjs --production';
const stagingMarkers = ['qflwsdrgdkkcxjnbxmis', 'tanstack-start-app-staging'];
function fail(code) { throw new Error(`CLOUDFLARE_PRODUCTION_GUARD:${code}`); }

export function assertProductionContext({ env = process.env, explicitProduction = false } = {}) {
  if (!explicitProduction) fail('EXPLICIT_PRODUCTION_FLAG_REQUIRED');
  if (env.CLOUDFLARE_DEPLOY_ENVIRONMENT !== 'production' || env.CLOUDFLARE_ENV !== 'production') fail('WRONG_ENVIRONMENT');
  if (env.EXPECTED_CLOUDFLARE_WORKER_NAME !== PRODUCTION_WORKER || env.CLOUDFLARE_WORKER_NAME !== PRODUCTION_WORKER) fail('WRONG_WORKER');
  if (env.CLOUDFLARE_ACCOUNT_ID !== PRODUCTION_ACCOUNT) fail('WRONG_ACCOUNT');
  const token = env.CLOUDFLARE_PRODUCTION_API_TOKEN;
  if (!/^cfat_[A-Za-z0-9_-]{20,}$/.test(token ?? '')) fail('MISSING_OR_INVALID_PRODUCTION_TOKEN');
  if (env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_API_TOKEN !== token) fail('AMBIGUOUS_GENERIC_TOKEN');
  if (env.CLOUDFLARE_API_KEY || env.CLOUDFLARE_EMAIL || env.CLOUDFLARE_API_BASE_URL) fail('ALTERNATE_CREDENTIAL_OR_ENDPOINT');
  for (const [name, value] of Object.entries(env)) {
    if (/^(?:STAGING_|VITE_|SUPABASE_|APP_URL$|GOOGLE_PLACES_)/.test(name) && value && (name.startsWith('STAGING_') || stagingMarkers.some(m => String(value).includes(m)))) fail('STAGING_ENVIRONMENT_PRESENT');
  }
  if (env.GOOGLE_PLACES_TEST_BUDGET === 'true') fail('STAGING_TEST_BUDGET');
  return Object.freeze({ worker: PRODUCTION_WORKER, account: PRODUCTION_ACCOUNT, token });
}

export function assertProductionConfig({ cwd = process.cwd(), configText, baselineText, requireRootMatch = false } = {}) {
  assertNoWranglerDeployRedirect(cwd);
  const config = JSON.parse(configText ?? readFileSync(resolve(cwd, 'wrangler.production.jsonc'), 'utf8'));
  const baseline = JSON.parse(baselineText ?? readFileSync(resolve(cwd, 'docs/google-places-production-preflight-20261002.json'), 'utf8'));
  const production = config.env?.production;
  if (requireRootMatch && readFileSync(resolve(cwd, 'wrangler.jsonc'),'utf8') !== readFileSync(resolve(cwd, 'wrangler.production.jsonc'),'utf8')) fail('ROOT_CONFIG_NOT_ISOLATED_PRODUCTION');
  const rootKeys = new Set(['$schema','name','workers_dev','keep_vars','compatibility_date','compatibility_flags','main','build','triggers','env']);
  const productionKeys = new Set(['name','workers_dev','preview_urls','vars']);
  if (Object.keys(config).some(k => !rootKeys.has(k)) || Object.keys(production ?? {}).some(k => !productionKeys.has(k))) fail('UNEXPECTED_BINDING_OR_SETTING');
  if (config.name !== 'bellza-deploy-blocked' || config.workers_dev !== false || config.keep_vars !== true) fail('UNSAFE_ROOT');
  if (config.build?.command !== PRODUCTION_HOOK || config.compatibility_date !== baseline.runtime.compatibility_date || JSON.stringify(config.compatibility_flags) !== JSON.stringify(baseline.runtime.compatibility_flags)) fail('RUNTIME_OR_HOOK_DRIFT');
  if (!production || production.name !== PRODUCTION_WORKER || production.workers_dev !== false || production.preview_urls !== false) fail('UNSAFE_PRODUCTION_TARGET');
  // Omit routing keys completely: the Dashboard owns the existing custom domains.
  for (const scope of [config, production]) {
    if (scope.route !== undefined || scope.routes !== undefined || scope.domains !== undefined || (scope.triggers?.crons?.length ?? 0) !== 0) fail('ROUTING_OR_SCHEDULE_CHANGE');
  }
  if (Object.keys(config.env).some(name => name !== 'production') || stagingMarkers.some(m => JSON.stringify(config).includes(m))) fail('STAGING_CONFIG_PRESENT');
  for (const [name, value] of Object.entries(baseline.production_selectors)) if (production.vars?.[name] !== value) fail('PRODUCTION_SELECTOR_DRIFT');
  if (!baseline.production_public_vars || JSON.stringify(production.vars) !== JSON.stringify(baseline.production_public_vars)) fail('PUBLIC_VARIABLE_DRIFT');
  if (production.vars?.VITE_SUPABASE_PROJECT_ID !== PRODUCTION_PROJECT) fail('WRONG_DATABASE');
  if (Object.keys(production.vars ?? {}).some(name => /^(?:GOOGLE_PLACES_API_KEY|GOOGLE_PLACES_ENABLED|GOOGLE_PLACES_TEST_BUDGET)$/.test(name))) fail('PLACES_SECRET_OR_MANUAL_FLAG_IN_CONFIG');
  return { worker: PRODUCTION_WORKER, configSha256: createHash('sha256').update(JSON.stringify(config)).digest('hex') };
}

export async function verifyProductionReadiness(context, { fetchImpl = fetch, requirePlaces = false, expectedCurrentVersion = PRODUCTION_ROLLBACK, rollbackCheck = false } = {}) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(expectedCurrentVersion) || (!rollbackCheck && expectedCurrentVersion !== PRODUCTION_ROLLBACK) || (rollbackCheck && requirePlaces)) fail('INVALID_BASELINE_OR_ROLLBACK_CHECK');
  const root = `https://api.cloudflare.com/client/v4/accounts/${context.account}`;
  async function get(path) {
    let response;
    try { response = await fetchImpl(root + path, { method: 'GET', headers: { Authorization: `Bearer ${context.token}` }, signal: AbortSignal.timeout(10000) }); }
    catch { fail('READ_ONLY_NETWORK_FAILURE'); }
    let body;
    try { body = await response.json(); } catch { fail('INVALID_API_RESPONSE'); }
    if (!response.ok || body.success !== true) fail(`READ_ONLY_HTTP_${response.status}`);
    return body.result;
  }
  if ((await get('/tokens/verify'))?.status !== 'active') fail('TOKEN_INACTIVE');
  const workers = await get('/workers/scripts');
  const names = Array.isArray(workers) ? workers.map(w => w.id ?? w.name).sort() : [];
  if (names.length !== 1 || names[0] !== PRODUCTION_WORKER) fail('TOKEN_SCOPE_NOT_EXCLUSIVELY_PRODUCTION');
  const history = await get(`/workers/scripts/${PRODUCTION_WORKER}/deployments`);
  const active = (Array.isArray(history) ? history : history?.deployments)?.[0];
  if (active?.versions?.length !== 1 || active.versions[0].version_id !== expectedCurrentVersion || active.versions[0].percentage !== 100) fail('PRODUCTION_BASELINE_CHANGED');
  const version = await get(`/workers/scripts/${PRODUCTION_WORKER}/versions/${PRODUCTION_ROLLBACK}`);
  const annotatedCommit = version.annotations?.['workers/message'] ?? version.metadata?.annotations?.['workers/message'];
  if (version.id !== PRODUCTION_ROLLBACK || annotatedCommit !== PRODUCTION_ROLLBACK_MESSAGE || version.resources?.script?.etag !== PRODUCTION_ROLLBACK_ETAG) fail('ROLLBACK_VERSION_OR_COMMIT_UNVERIFIED');
  if (requirePlaces) {
    const settings = await get(`/workers/scripts/${PRODUCTION_WORKER}/settings`);
    const bindings = settings?.bindings ?? [];
    if (!bindings.some(b => b.name === 'GOOGLE_PLACES_API_KEY' && b.type === 'secret_text')) fail('PRODUCTION_PLACES_SECRET_MISSING');
    if (!bindings.some(b => b.name === 'GOOGLE_PLACES_ENABLED' && b.type === 'plain_text' && b.text === 'true')) fail('PRODUCTION_PLACES_FLAG_MISSING');
    if (bindings.some(b => b.name === 'GOOGLE_PLACES_TEST_BUDGET' && b.text === 'true')) fail('STAGING_TEST_BUDGET');
  }
  return { tokenStatus: 'active', visibleWorkers: names, rollbackVersion: PRODUCTION_ROLLBACK, observedVersion: expectedCurrentVersion, baselineUnchanged: expectedCurrentVersion === PRODUCTION_ROLLBACK, rollbackCheck, mutationPerformed: false };
}

export function productionArtifactConfig(sourceConfig) {
  // Only built code/assets differ from the pinned source deployment config.
  return {...sourceConfig, main:'index.js', assets:{directory:'../client'}, no_bundle:true, rules:[{type:'ESModule',globs:['**/*.js','**/*.mjs']}]};
}

export function assertProductionArtifact({cwd=process.cwd()}={}) {
  assertProductionConfig({cwd,requireRootMatch:true});
  const source=JSON.parse(readFileSync(resolve(cwd,'wrangler.production.jsonc'),'utf8'));
  const actual=JSON.parse(readFileSync(resolve(cwd,'dist/server/wrangler.production.jsonc'),'utf8'));
  if(JSON.stringify(actual)!==JSON.stringify(productionArtifactConfig(source)) || !existsSync(resolve(cwd,'dist/server/index.js')) || !existsSync(resolve(cwd,'dist/client'))) fail('PRODUCTION_ARTIFACT_MISMATCH');
  return {worker:PRODUCTION_WORKER,configSha256:createHash('sha256').update(JSON.stringify(actual)).digest('hex')};
}

export function productionRollbackCommand() {
  return ['rollback', PRODUCTION_ROLLBACK, '--env', 'production', '--name', PRODUCTION_WORKER, '--config', 'wrangler.production.jsonc', '--message', 'Google Places controlled production rollback'];
}
