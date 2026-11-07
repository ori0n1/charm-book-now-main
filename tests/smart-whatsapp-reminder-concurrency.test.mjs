import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../src/lib/whatsapp.functions.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('whatsapp.functions.ts', source, ts.ScriptTarget.ES2022, true);
const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node) &&
  node.name?.text === 'sendConfirmationFromContext');
assert.ok(declaration);
const compiled = ts.transpileModule(`export ${declaration.getText(ast)}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ existingLog = null, synchronizeFirstReads = false } = {}) {
  const startsAt = '2026-11-08T12:00:00.000Z';
  const key = `arara-reminder-2h-appointment-1-${Date.parse(startsAt)}`;
  const sentKeys = [];
  let log = existingLog;
  let firstReads = 0;
  let releaseReads;
  const firstReadsReady = new Promise((resolve) => { releaseReads = resolve; });
  const dependencies = {
    hasStudioEntitlement: async () => true,
    findExistingLog: async () => {
      if (!synchronizeFirstReads || firstReads >= 2) return log;
      firstReads += 1;
      if (firstReads === 2) releaseReads();
      await firstReadsReady;
      return null;
    },
    findExistingConfirmationLog: async () => null,
    renderMessage: () => 'synthetic reminder',
    sendEmailConfirmationFromContext: async () => null,
    normalizeWhatsAppPhone: () => '+351900000000',
    reserveWhatsAppUsage: async () => ({ allowed: true }),
    insertLog: async () => {
      if (log) return null;
      log = { id: 'synthetic-log', status: 'pending', provider: 'senddm', payload: {}, created_at: new Date().toISOString() };
      return log;
    },
    updateLog: async (_sb, _id, patch) => { log = { ...log, ...patch }; return log; },
    getWhatsAppProvider: () => ({ sendText: async ({ idempotencyKey }) => {
      sentKeys.push(idempotencyKey);
      return { provider: 'senddm', messageId: 'synthetic-message', deliveryStatus: 'DELIVERED', payload: {} };
    } }),
    finalizeWhatsAppUsage: async () => {},
    maskPhoneForLog: () => 'masked',
    publicOrderIdFromUrl: () => 'synthetic',
    buildTemplateVariables: () => ({}),
    formatStudioDate: () => '08/11/2026',
    formatStudioTime: () => '12:00',
    isStalePendingWhatsAppLog: () => true,
    sendDmExplicitRetryKey: () => { throw new Error('unexpected explicit retry'); },
    ARARA_PROVIDER: 'arara',
    WHATSAPP_PROVIDER: 'senddm',
    DEFAULT_TEMPLATE: '',
    WhatsAppDeliveryError: class WhatsAppDeliveryError extends Error {},
  };
  const exports = {};
  const names = Object.keys(dependencies);
  new Function('exports', ...names, compiled)(exports, ...names.map((name) => dependencies[name]));
  const sb = { from: (table) => {
    assert.equal(table, 'appointments');
    return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { status: 'confirmed', starts_at: startsAt, whatsapp_reminder_confirmed_at: null }, error: null }; } };
  } };
  const ctx = { appointmentId: 'appointment-1', studioId: 'studio-1', startsAt,
    clientPhone: '+351900000000', paymentRowId: 'appointment-1', bookingUrl: 'https://bellza.pt/reserva',
    studioTimezone: 'Europe/Lisbon', studioName: 'Estúdio', serviceName: 'Serviço', clientName: 'Cliente',
    messageKind: 'reminder_2h', autoEnabled: true, template: 'synthetic reminder' };
  const send = () => exports.sendConfirmationFromContext(sb, ctx, key, { skipEmail: true });
  return { send, sentKeys, key, getLog: () => log };
}

test('concurrent first attempts claim one log and emit one provider request', async () => {
  const h = harness({ synchronizeFirstReads: true });
  await Promise.all([h.send(), h.send()]);
  assert.deepEqual(h.sentKeys, [h.key]);
  assert.equal(h.getLog().status, 'sent');
  await h.send();
  assert.deepEqual(h.sentKeys, [h.key]);
});

test('concurrent stale retries retain the same provider idempotency key', async () => {
  const h = harness({ existingLog: { id: 'synthetic-log', status: 'pending', provider: 'senddm',
    payload: {}, created_at: '2026-11-07T00:00:00.000Z' } });
  await Promise.all([h.send(), h.send()]);
  assert.deepEqual(h.sentKeys, [h.key, h.key]);
});
