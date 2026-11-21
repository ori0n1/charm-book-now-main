import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReleaseEvidence } from '../scripts/check-bellza-release.mjs';

const old = '11111111-1111-4111-8111-111111111111';
const next = '22222222-2222-4222-8222-222222222222';
const commit = 'a'.repeat(40);
const hash = 'b'.repeat(64);
const names = ['workerStart', 'routesApis', 'authPermissions', 'agendaReservations',
  'paymentsStripeConnect', 'whatsapp', 'email', 'push', 'bindingsSecretsCrons',
  'existingFeatures', 'criticalErrors'];
function complete() {
  return {
    authorization: { versionId: next, commit, fullWorkerCycle: true },
    baseline: { activeVersion: old, activeTrafficPercent: 100,
      rollbackVersion: old, rollbackAvailable: true, rollbackSafe: true },
    artifact: { versionId: next, commit, unchanged: true, localManifestSha256: hash,
      configSha256: hash, uploadedScriptEtag: hash },
    config: { bindings: true, secretNamesAndTypes: true, crons: true, domains: true,
      modules: true, assets: true, routes: true },
    safety: { noRealTransactions: true, noRealMessages: true, noRealDataWrites: true },
    tests: Object.fromEntries(names.map((name) => [name, { status: 'PASS', versionId: next,
      method: name === 'bindingsSecretsCrons' ? 'cloudflare-metadata' : 'remote-version',
      evidence: `synthetic-evidence-${name}`, isolated: true }])),
  };
}

test('aceita somente um ciclo completo com provas da versão carregada', () => {
  assert.deepEqual(validateReleaseEvidence(complete()), []);
});

test('bloqueia teste local usado como substituto do Worker carregado', () => {
  const evidence = complete();
  evidence.tests.agendaReservations.method = 'local-build';
  assert.ok(validateReleaseEvidence(evidence).includes('ATOMIC_AGENDARESERVATIONS_FAILED'));
});

test('bloqueia rollback incerto, versão trocada ou tráfego anterior alterado', () => {
  const evidence = complete();
  evidence.baseline.rollbackSafe = false;
  evidence.baseline.activeTrafficPercent = 50;
  evidence.authorization.versionId = old;
  const failures = validateReleaseEvidence(evidence);
  assert.ok(failures.includes('WORKER_ROLLBACK_UNVERIFIED'));
  assert.ok(failures.includes('ACTIVE_BASELINE_UNVERIFIED'));
  assert.ok(failures.includes('AUTHORIZED_VERSION_MISMATCH'));
});

test('bloqueia ausência de qualquer canal de notificação ou segurança dos testes', () => {
  const evidence = complete();
  delete evidence.tests.push;
  evidence.safety.noRealMessages = false;
  const failures = validateReleaseEvidence(evidence);
  assert.ok(failures.includes('ATOMIC_PUSH_FAILED'));
  assert.ok(failures.includes('SAFETY_NOREALMESSAGES_UNVERIFIED'));
});
