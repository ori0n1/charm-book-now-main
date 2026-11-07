import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../src/lib/senddm-booking-lifecycle.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("exports", "require", compiled)(exports, require);
const { SENDDM_LIFECYCLE_PARAMETERS, SENDDM_SMART_REMINDER_PARAMETERS, buildSendDmSmartReminderParameters } = exports;

test("new template keeps old parameters and the existing button URL suffix", () => {
  const values = {
    nomeCliente: "Maria",
    data: "08/11/2026",
    hora: "12:00",
    servico: "Corte",
    profissional: "Ana",
  };
  const parameters = buildSendDmSmartReminderParameters(values, "https://bellza.pt/r/abcDEF_123", "Salão Évora");
  assert.deepEqual(SENDDM_SMART_REMINDER_PARAMETERS.slice(0, -1), SENDDM_LIFECYCLE_PARAMETERS);
  assert.deepEqual(Object.keys(parameters), [...SENDDM_LIFECYCLE_PARAMETERS, "nomeEstudio"]);
  assert.equal(parameters.reservaToken, "abcDEF_123");
  assert.equal(parameters.nomeEstudio, "Salão Évora");
  assert.throws(() => buildSendDmSmartReminderParameters(values, "https://example.com/r/abcDEF_123", "Salão Évora"));
  assert.throws(() => buildSendDmSmartReminderParameters(values, "https://bellza.pt/r/abcDEF_123", ""));
});
