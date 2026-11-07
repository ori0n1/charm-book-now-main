import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/whatsapp.functions.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("whatsapp.functions.ts", source, ts.ScriptTarget.ES2022, true);
const entrypoints = ast.statements
  .filter((node) => ts.isFunctionDeclaration(node) && [
    "dispatchDueAraraTwoHourReminders", "dispatchSmartRemindersFromCron",
  ].includes(node.name?.text))
  .map((node) => node.getText(ast));
assert.equal(entrypoints.length, 2);
const compiled = ts.transpileModule(entrypoints.join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function dispatcherWith(templateId) {
  const calls = { smart: 0, legacy: [] };
  const exports = {};
  new Function("exports", "getServerEnv", "dispatchDueSmartWhatsAppReminders", "dispatchLegacyTwoHourReminders", compiled)(
    exports,
    async (name) => {
      assert.equal(name, "SENDDM_SMART_REMINDER_TEMPLATE_ID");
      return templateId;
    },
    async () => { calls.smart += 1; return { checked: 2, dispatched: 1 }; },
    async (onlyWithoutConfirmationAnchor) => {
      calls.legacy.push(onlyWithoutConfirmationAnchor);
      return { checked: 3, dispatched: 1 };
    },
  );
  return { ...exports, calls };
}

test("approved template routes the minute cron only to smart reminders", async () => {
  const dispatcher = dispatcherWith("ceb5d4be-985c-48fd-896c-7afff61e9d1c");
  assert.deepEqual(await dispatcher.dispatchSmartRemindersFromCron(), { checked: 2, dispatched: 1 });
  assert.deepEqual(dispatcher.calls, { smart: 1, legacy: [] });
  assert.deepEqual(await dispatcher.dispatchDueAraraTwoHourReminders(), { checked: 3, dispatched: 1 });
  assert.deepEqual(dispatcher.calls, { smart: 1, legacy: [true] });
});

test("rollback without the approved template retains only the legacy dispatcher", async () => {
  const dispatcher = dispatcherWith("");
  assert.deepEqual(await dispatcher.dispatchSmartRemindersFromCron(), { checked: 0, dispatched: 0 });
  assert.deepEqual(await dispatcher.dispatchDueAraraTwoHourReminders(), { checked: 3, dispatched: 1 });
  assert.deepEqual(dispatcher.calls, { smart: 0, legacy: [false] });
});

test("transition limits the existing dispatcher to appointments without an anchor", async () => {
  const sourceFunction = ast.statements.find((node) => ts.isFunctionDeclaration(node) &&
    node.name?.text === "dispatchLegacyTwoHourReminders");
  assert.ok(sourceFunction);
  const compiledLegacy = ts.transpileModule(`export ${sourceFunction.getText(ast)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  async function scan(onlyWithoutConfirmationAnchor) {
    const filters = [];
    const query = {
      select() { return this; }, eq() { return this; },
      is(name, value) { filters.push([name, value]); return this; },
      gte() { return this; }, lt() { return this; }, order() { return this; },
      async limit() { return { data: [], error: null }; },
    };
    const exports = {};
    new Function("exports", "getServerEnv", "normalizeWhatsAppPhone", "admin", compiledLegacy)(
      exports, async () => "off", () => "", () => ({ from: () => query }),
    );
    assert.deepEqual(await exports.dispatchLegacyTwoHourReminders(onlyWithoutConfirmationAnchor),
      { checked: 0, dispatched: 0 });
    return filters;
  }
  assert.deepEqual(await scan(true), [["whatsapp_reminder_confirmed_at", null]]);
  assert.deepEqual(await scan(false), []);
});
