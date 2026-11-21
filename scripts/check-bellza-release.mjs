import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const id = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const sha = /^[0-9a-f]{64}$/;
const checks = [
  'workerStart', 'routesApis', 'authPermissions', 'agendaReservations',
  'paymentsStripeConnect', 'whatsapp', 'email', 'push',
  'bindingsSecretsCrons', 'existingFeatures', 'criticalErrors',
];
const behaviorChecks = new Set(checks.filter((name) => name !== 'bindingsSecretsCrons'));

export function validateReleaseEvidence(evidence) {
  const e = evidence ?? {};
  const failures = [];
  const need = (condition, code) => { if (!condition) failures.push(code); };
  const authorized = e.authorization ?? {};
  const baseline = e.baseline ?? {};
  const artifact = e.artifact ?? {};
  const config = e.config ?? {};
  const safety = e.safety ?? {};

  need(id.test(authorized.versionId ?? '') && authorized.versionId === artifact.versionId,
    'AUTHORIZED_VERSION_MISMATCH');
  need(/^[0-9a-f]{40}$/.test(authorized.commit ?? '') && authorized.commit === artifact.commit,
    'AUTHORIZED_COMMIT_MISMATCH');
  need(authorized.fullWorkerCycle === true, 'FULL_CYCLE_AUTHORIZATION_MISSING');
  need(id.test(baseline.activeVersion ?? '') && baseline.activeVersion !== artifact.versionId &&
    baseline.activeTrafficPercent === 100, 'ACTIVE_BASELINE_UNVERIFIED');
  need(baseline.rollbackVersion === baseline.activeVersion && baseline.rollbackAvailable === true &&
    baseline.rollbackSafe === true, 'WORKER_ROLLBACK_UNVERIFIED');
  need(artifact.unchanged === true && sha.test(artifact.localManifestSha256 ?? '') &&
    sha.test(artifact.configSha256 ?? '') && sha.test(artifact.uploadedScriptEtag ?? ''),
    'UPLOADED_ARTIFACT_UNVERIFIED');
  for (const name of ['bindings', 'secretNamesAndTypes', 'crons', 'domains', 'modules', 'assets', 'routes']) {
    need(config[name] === true, `CONFIG_${name.toUpperCase()}_UNVERIFIED`);
  }
  for (const name of ['noRealTransactions', 'noRealMessages', 'noRealDataWrites']) {
    need(safety[name] === true, `SAFETY_${name.toUpperCase()}_UNVERIFIED`);
  }
  for (const name of checks) {
    const test = e.tests?.[name] ?? {};
    need(test.status === 'PASS' && test.versionId === artifact.versionId &&
      typeof test.evidence === 'string' && test.evidence.trim().length >= 12 &&
      (behaviorChecks.has(name) ? test.method === 'remote-version' && test.isolated === true :
        ['remote-version', 'cloudflare-metadata'].includes(test.method)),
      `ATOMIC_${name.toUpperCase()}_FAILED`);
  }
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf('--evidence');
  if (index < 0 || !process.argv[index + 1]) {
    console.error('BLOQUEADO: indique --evidence <ficheiro.json>');
    process.exitCode = 1;
  } else {
    try {
      const evidence = JSON.parse(readFileSync(process.argv[index + 1], 'utf8'));
      const failures = validateReleaseEvidence(evidence);
      if (failures.length) {
        console.error(`BLOQUEADO: ${failures.join(', ')}`);
        process.exitCode = 1;
      } else {
        console.log(`GATE_APTO: ${evidence.artifact.versionId}; confirmar provas antes de promover trafego`);
      }
    } catch {
      console.error('BLOQUEADO: evidencia ausente ou invalida');
      process.exitCode = 1;
    }
  }
}
