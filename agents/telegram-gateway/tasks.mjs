import { existsSync, mkdirSync, readFileSync, renameSync,
  statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ACTIONS = Object.freeze({
  task_overview: { agent: "atlas", operation: "overview" },
  task_monitor: { agent: "sentinela", operation: "monitor_status" },
  task_watch: { agent: "sentinela", operation: "monitor_alerts" },
  task_investigate: { agent: "sherlock", operation: "diagnose_anomaly" },
  task_validate: { agent: "valida", operation: "run_synthetic_tests", approval: true },
  task_propose: { agent: "forge", operation: "prepare_investigation" },
});
export const TASK_TOOLS = Object.freeze(Object.keys(ACTIONS));
const TERMINAL = new Set(["CONCLUIDA", "BLOQUEADA", "FALHOU"]);
const MAX_TASKS = 200;
const MAX_STATE_BYTES = 1_000_000;
const MAX_EVENTS = 12;
const MAX_RUNNING = 1;
const DAY_LIMIT = 30;
const TTL_MS = 15 * 60_000;
const WATCH_MS = 7 * 24 * 60 * 60_000;
const DURATION_MS = 75_000;
const safe = (value, max = 120) => String(value ?? "")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[omitido]")
  .replace(/\b(?:\+?\d[\s-]?){9,}\b/g, "[omitido]")
  .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gi, "[omitido]").slice(0, max);
function portugalTime(value) {
  if (!Number.isFinite(Date.parse(value ?? ""))) return "hora indisponível";
  return new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(value));
}
const SOURCE_LABELS = Object.freeze({
  MONITOR_JOURNAL: "diário", CURRENT_SENTINELA_REPORT: "Sentinela atual",
  PRIOR_SENTINELA_REPORT: "Sentinela anterior",
  PUBLIC_STATE: "HTTP", CURRENT_PUBLIC_STATE: "HTTP atual",
  VISUAL_STATE: "visual", CURRENT_VISUAL_STATE: "visual atual",
  ATLAS_INCIDENT_HISTORY: "incidentes", SHERLOCK_TASK_DIAGNOSIS: "Sherlock",
  FRESH_DIAGNOSIS: "diagnóstico recente",
});
const REASON_LABELS = Object.freeze({
  CURRENT_SENTINELA_REPORT_MISSING: "relatório atual ausente",
  MONITOR_JOURNAL_UNAVAILABLE: "diário indisponível",
  MONITOR_INDETERMINATE: "monitor inconclusivo",
  CAUSE_NOT_PROVEN: "causa não comprovada",
  DIAGNOSIS_ARTIFACT_UNAVAILABLE: "diagnóstico indisponível",
  DIAGNOSIS_STALE: "diagnóstico antigo",
  PATCH_PROOF_REQUIRED: "prova para patch em falta",
});
function sources(values) {
  const shown = values.slice(0, 4).map((value) =>
    SOURCE_LABELS[value] ?? value).join(", ");
  return shown + (values.length > 4 ? ` +${values.length - 4}` : "");
}
const initial = () => ({ schema: 1, tasks: [], approvals: [] });
function load(dir) {
  const path = join(dir, "tasks-state.json");
  if (!existsSync(path)) return initial();
  let state;
  try {
    if (statSync(path).size > MAX_STATE_BYTES) throw new Error();
    state = JSON.parse(readFileSync(path, "utf8"));
  }
  catch { throw new Error("TASK_STATE_INVALID"); }
  if (state?.schema !== 1 || !Array.isArray(state.tasks) ||
      !Array.isArray(state.approvals) || state.tasks.length > MAX_TASKS ||
      state.approvals.length > MAX_TASKS || state.tasks.some((t) =>
        !UUID.test(t.id ?? "") || !Array.isArray(t.events) ||
        t.events.length > MAX_EVENTS)) throw new Error("TASK_STATE_INVALID");
  return state;
}
function save(dir, state) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "tasks-state.json");
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}
function transition(task, status, at, code) {
  task.status = status;
  task.updatedAt = at;
  task.events = [...task.events, { at, status, code }].slice(-MAX_EVENTS);
}
function compactEvidence(result) {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  return {
    source: safe(result?.source ?? "INDISPONIVEL", 40),
    status: safe(result?.status ?? "INDETERMINADO", 40),
    observedAt: Number.isFinite(Date.parse(result?.observedAt ?? ""))
      ? result.observedAt : null,
    causeStatus: safe(result?.causeStatus ?? findings[0]?.causeStatus ??
      "NAO_DETERMINADA", 40),
    codes: findings.map((x) => safe(x.code, 50)).slice(0, 5),
    runIds: Array.isArray(result?.evidenceRunIds) ? result.evidenceRunIds
      .filter((id) => UUID.test(id)).slice(0, 5) : [],
    monitorId: UUID.test(result?.monitorId ?? "") ? result.monitorId : null,
    codeFiles: Array.isArray(result?.codeContext?.files) ?
      result.codeContext.files.slice(0, 4).map((x) => ({
        file: safe(x.file, 100), sha256: safe(x.sha256, 16) })) : [],
    sourcesConsulted: Array.isArray(result?.sourcesConsulted) ?
      result.sourcesConsulted.filter((x) => /^[A-Z_]{3,50}$/.test(x))
        .slice(0, 6) : [],
    sourcesUnavailable: Array.isArray(result?.sourcesUnavailable) ?
      result.sourcesUnavailable.filter((x) => /^[A-Z_]{3,50}$/.test(x))
        .slice(0, 6) : [],
    reason: /^[A-Z_]{3,60}$/.test(result?.reason ?? "")
      ? result.reason : null,
    historicalCodes: Array.isArray(result?.historicalCodes) ?
      result.historicalCodes.filter((x) => /^[A-Z0-9_]{3,80}$/.test(x))
        .slice(0, 4) : [],
    patchProof: result?.patchProof?.sourceVerified === true &&
      UUID.test(result.patchProof.from ?? "") &&
      UUID.test(result.patchProof.to ?? "") &&
      Number.isFinite(Date.parse(result.patchProof.verifiedAt ?? "")) ? {
        sourceVerified: true, from: result.patchProof.from,
        to: result.patchProof.to,
        verifiedAt: result.patchProof.verifiedAt } : null,
    applied: false,
  };
}
function latestTaskId(message) {
  const match = String(message).match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i);
  return match?.[0]?.toLowerCase() ?? null;
}
export function approvalButtons(id) {
  if (!UUID.test(id ?? "")) throw new Error("TASK_APPROVAL_INVALID");
  return { inline_keyboard: [[
    { text: "Aprovar", callback_data: `t:${id}:A` },
    { text: "Rejeitar", callback_data: `t:${id}:R` },
    { text: "Ver detalhes", callback_data: `t:${id}:D` },
  ]] };
}
export function createTaskManager({ stateDir, toolRunner, now = () => new Date() } = {}) {
  if (!stateDir || !toolRunner) throw new Error("TASK_CONFIG_INVALID");
  const timestamp = () => now().toISOString();
  function recover() {
    const state = load(stateDir);
    let changed = false;
    for (const task of state.tasks) {
      if (task.status === "EM_EXECUCAO") {
        transition(task, "BLOQUEADA", timestamp(), "RESTART_REQUIRES_REVIEW");
        changed = true;
      } else if (task.tool === "task_watch" && task.status === "PENDENTE" &&
          now().getTime() - Date.parse(task.watchAfter) >= WATCH_MS) {
        transition(task, "BLOQUEADA", timestamp(), "WATCH_EXPIRED");
        changed = true;
      } else if (task.status === "AGUARDANDO_APROVACAO" &&
          state.approvals.some((a) => a.taskId === task.id &&
            a.status === "APROVADA")) {
        transition(task, "BLOQUEADA", timestamp(),
          "APPROVED_ACTION_INTERRUPTED");
        changed = true;
      }
    }
    for (const approval of state.approvals) {
      if (approval.status === "PENDENTE" &&
          Date.parse(approval.expiresAt) <= now().getTime()) {
        approval.status = "EXPIRADA";
        changed = true;
      }
    }
    if (changed) save(stateDir, state);
    return { blockedAfterRestart: state.tasks.filter((t) =>
      t.events.at(-1)?.code === "RESTART_REQUIRES_REVIEW").length };
  }
  async function execute(state, task) {
    const spec = ACTIONS[task.tool];
    if (state.tasks.some((t) => t.id !== task.id &&
        t.status === "EM_EXECUCAO")) {
      transition(task, "BLOQUEADA", timestamp(), "CONCURRENT_TASK");
      save(stateDir, state);
      return task;
    }
    transition(task, "EM_EXECUCAO", timestamp(), "STARTED");
    save(stateDir, state);
    try {
      const operation = task.tool === "task_propose" && task.patchProof
        ? "prepare_patch_workspace" : spec.operation;
      const op = toolRunner[operation];
      if (typeof op !== "function") throw new Error("TOOL_UNAVAILABLE");
      let timer;
      const result = await Promise.race([
        Promise.resolve().then(() => op({ studio: task.studio,
          hours: task.hours, taskId: task.id,
          dependencyId: task.dependencyId, proof: task.patchProof })),
        new Promise((_, reject) => { timer = setTimeout(() =>
          reject(new Error("TASK_TIMEOUT")), DURATION_MS); }),
      ]).finally(() => clearTimeout(timer));
      if (task.tool === "task_propose" && !task.patchProof &&
          !["BLOQUEADO", "INDETERMINADO", "SEM_EVIDENCIA"].includes(result?.status)) {
        result.status = "BLOQUEADO";
        result.reason = state.tasks.find((item) =>
          item.id === task.dependencyId)?.evidence?.causeStatus === "CONFIRMADA"
          ? "PATCH_PROOF_REQUIRED" : "CAUSE_NOT_PROVEN";
        result.applied = false;
      }
      if (task.tool === "task_investigate" &&
          typeof toolRunner.inspect_code_context === "function") {
        result.codeContext = toolRunner.inspect_code_context({
          codes: (result.findings ?? []).map((x) => x.code).slice(0, 5) });
      }
      const evidence = compactEvidence(result);
      const sourceMismatch = task.tool === "task_investigate" &&
        task.dependencyId && state.tasks.find((t) =>
          t.id === task.dependencyId)?.evidence?.monitorId &&
        evidence.monitorId !== state.tasks.find((t) =>
          t.id === task.dependencyId).evidence.monitorId;
      if (sourceMismatch && !task.dependencyExplicit) {
        task.dependencyId = null;
        task.events = [...task.events, { at: timestamp(),
          status: "EM_EXECUCAO", code: "AUTO_DEPENDENCY_STALE" }]
          .slice(-MAX_EVENTS);
      }
      // A timeout or failed tool may continue in its own process. No retry or
      // second operation is started without human review.
      task.evidence = evidence;
      const unresolved = evidence.source === "INDISPONIVEL" ||
        ["INDETERMINADO", "INDETERMINATE", "SEM_EVIDENCIA",
          "BLOQUEADO"].includes(evidence.status);
      const testsFailed = task.tool === "task_validate" &&
        evidence.status === "FAILED";
      transition(task, (sourceMismatch && task.dependencyExplicit) || unresolved ? "BLOQUEADA" :
        testsFailed ? "FALHOU" : "CONCLUIDA", timestamp(),
      (sourceMismatch && task.dependencyExplicit) ? "SOURCE_RUN_MISMATCH" : unresolved ?
        "EVIDENCE_INSUFFICIENT" : testsFailed ? "TESTS_FAILED" :
          "RESULT_RECORDED");
    } catch (error) {
      transition(task, "FALHOU", timestamp(),
        /^[A-Z_]{3,50}$/.test(error?.message ?? "") ? error.message :
          "TOOL_FAILED");
    }
    save(stateDir, state);
    return task;
  }
  function display(task) {
    const e = task.evidence;
    return `Tarefa ${task.id}: ${task.agent} ${task.status}. ` +
      (e ? `${!e.sourcesConsulted?.length ?
        `Fonte ${e.source}; ${e.status}. ` : ""}` +
        `${e.codes?.length ? `${e.codes.join(", ")}. ` : ""}` +
        `${e.observedAt ? `${portugalTime(e.observedAt)} (Portugal). ` : ""}` +
        `${e.sourcesConsulted?.length ? `Li: ${sources(e.sourcesConsulted)}. ` : ""}` +
        `${e.sourcesUnavailable?.length ? `Falta: ${sources(e.sourcesUnavailable)}. ` : ""}` +
        `${e.reason ? `${REASON_LABELS[e.reason] ?? e.reason}. ` : ""}` +
        `${task.agent === "forge" ? "Sem patch." : ""}` :
        `Motivo ${task.events.at(-1)?.code ?? "PENDENTE"}.`);
  }
  async function request({ botKey, tool, message, studio = null,
    hours = 24, updateId }) {
    if (!Object.hasOwn(ACTIONS, tool) || !Number.isSafeInteger(updateId) ||
        !["atlas", ACTIONS[tool].agent].includes(botKey) ||
        (studio !== null && !/^[\p{L}\p{N} _-]{1,40}$/u.test(studio)) ||
        !Number.isInteger(hours) || hours < 1 || hours > 24)
      return { status: "TOOL_DENIED", reply: "Operação não autorizada." };
    const state = load(stateDir);
    const source = `${botKey}:${updateId}`;
    const duplicate = state.tasks.find((t) => t.source === source);
    if (duplicate) return { status: "DUPLICATE", reply: display(duplicate) };
    if (tool === "task_overview") {
      const cutoff = now().getTime() - hours * 60 * 60_000;
      const recent = state.tasks.filter((t) =>
        Date.parse(t.createdAt) >= cutoff).slice(-8);
      return { status: "HANDLED", reply: recent.length
        ? `Tarefas das últimas ${hours} h: ${recent.map((t) =>
          `${t.id.slice(0, 8)} ${t.agent} ${t.status}`).join("; ")}.`
        : `Sem tarefas registadas nas últimas ${hours} h.` };
    }
    const day = timestamp().slice(0, 10);
    if (state.tasks.filter((t) => t.createdAt.startsWith(day)).length >= DAY_LIMIT)
      return { status: "TASK_LIMIT", reply: "Limite diário de tarefas atingido." };
    if (state.tasks.filter((t) => t.status === "EM_EXECUCAO").length >= MAX_RUNNING)
      return { status: "TASK_BUSY", reply: "Já há uma tarefa em execução. Tente depois." };
    const referenceId = latestTaskId(message);
    const predecessor = referenceId ? state.tasks.find((t) => t.id === referenceId) :
      [...state.tasks].reverse().find((t) => t.agent ===
        (tool === "task_propose" ? "sherlock" : tool === "task_validate" ?
          "forge" : "sentinela"));
    const task = { id: randomUUID(), source, tool,
      agent: ACTIONS[tool].agent, studio: studio ? safe(studio, 40) : null,
      hours, dependencyId: predecessor?.id ?? null,
      dependencyExplicit: referenceId !== null,
      status: "PENDENTE", createdAt: timestamp(), updatedAt: timestamp(),
      events: [{ at: timestamp(), status: "PENDENTE", code: "CREATED" }],
      evidence: null,
      patchProof: tool === "task_propose" &&
        predecessor?.agent === "sherlock" &&
        predecessor.status === "CONCLUIDA" &&
        predecessor.evidence?.causeStatus === "CONFIRMADA" &&
        now().getTime() - Date.parse(predecessor.updatedAt) <=
          24 * 60 * 60_000 &&
        predecessor.evidence?.patchProof?.sourceVerified === true
        ? predecessor.evidence.patchProof : null };
    if (state.tasks.length >= MAX_TASKS) {
      const old = state.tasks.findIndex((t) => TERMINAL.has(t.status));
      if (old < 0) return { status: "TASK_LIMIT",
        reply: "Limite de tarefas abertas atingido." };
      state.tasks.splice(old, 1);
    }
    state.tasks.push(task);
    save(stateDir, state);
    if ((referenceId && !predecessor) ||
        (tool === "task_propose" && predecessor &&
          predecessor.agent !== "sherlock")) {
      transition(task, "BLOQUEADA", timestamp(), referenceId && !predecessor
        ? "TASK_REFERENCE_NOT_FOUND" : "SHERLOCK_TASK_REQUIRED");
      save(stateDir, state);
      return { status: "HANDLED", task, reply: display(task) };
    }
    if (task.patchProof &&
        (now().getTime() - Date.parse(task.patchProof.verifiedAt) >
          60 * 60_000 ||
          Date.parse(task.patchProof.verifiedAt) > now().getTime())) {
      transition(task, "BLOQUEADA", timestamp(), "VERSION_PROOF_EXPIRED");
      save(stateDir, state);
      return { status: "HANDLED", task, reply: display(task) };
    }
    if (ACTIONS[tool].approval || task.patchProof) {
      const approval = { id: randomUUID(), taskId: task.id, agent: task.agent,
        action: task.patchProof ? "PREPARE_LOCAL_PATCH_PROPOSAL" :
          "RUN_LOCAL_SYNTHETIC_TESTS", status: "PENDENTE",
        createdAt: timestamp(), expiresAt: new Date(now().getTime() + TTL_MS).toISOString() };
      state.approvals.push(approval);
      if (state.approvals.length > MAX_TASKS)
        state.approvals = state.approvals.slice(-MAX_TASKS);
      transition(task, "AGUARDANDO_APROVACAO", timestamp(), "LOCAL_APPROVAL_REQUIRED");
      save(stateDir, state);
      return { status: "APPROVAL_REQUIRED", task, approval,
        reply: `Aprovação ${approval.id}. Tarefa ${task.id}; ${task.agent}. ` +
          (task.patchProof ?
            `Escopo: criar worktree local e proposta não aplicada para agents/reference.json. Risco: escrita local; sem publicação. Evidência: causa comprovada na tarefa ${predecessor.id}. ` :
            `Escopo: sete testes sintéticos locais. Risco: consumo local e até 75 s; sem escrita remota. Evidência: pedido recebido, teste ainda não executado. `) +
          `Expira ${portugalTime(approval.expiresAt)} (Portugal).`,
        buttons: approvalButtons(approval.id) };
    }
    if (tool === "task_watch") {
      task.watchAfter = timestamp();
      task.evidence = { source: "LOCAL_WATCH", status: "AGUARDANDO_EVENTO",
        observedAt: null, causeStatus: "NAO_DETERMINADA", codes: [],
        runIds: [], monitorId: null, codeFiles: [], applied: false };
      save(stateDir, state);
      return { status: "HANDLED", task,
        reply: `Tarefa ${task.id}: acompanhamento registado para ` +
          `${task.studio ?? "todos os estúdios"}. Avisos seguem os alertas ` +
          `existentes da Sentinela; nenhuma falha foi confirmada agora.` };
    }
    await execute(state, task);
    return { status: "HANDLED", task, reply: display(task) };
  }
  async function callback({ botKey, data }) {
    const match = /^t:([0-9a-f-]{36}):([ARD])$/.exec(data ?? "");
    if (!match || !UUID.test(match[1]) ||
        !["atlas", "valida", "forge"].includes(botKey))
      return { status: "REJECTED", reply: "Pedido inválido." };
    const state = load(stateDir);
    const approval = state.approvals.find((a) => a.id === match[1]);
    const task = state.tasks.find((t) => t.id === approval?.taskId);
    if (!approval || !task) return { status: "REJECTED", reply: "Aprovação não encontrada." };
    if (!task.source.startsWith(`${botKey}:`))
      return { status: "REJECTED", reply: "Aprovação de outro bot." };
    if (match[2] === "D") return { status: "DETAILS", reply:
      `Tarefa ${task.id}; agente ${task.agent}; ação ${approval.action}; ` +
      `escopo local, sem produção. Estado ${approval.status}. ` +
      `Expira ${portugalTime(approval.expiresAt)} (Portugal).` };
    if (approval.status !== "PENDENTE" ||
        task.status !== "AGUARDANDO_APROVACAO")
      return { status: "REPLAY", reply: "Aprovação já usada ou encerrada." };
    if (Date.parse(approval.expiresAt) <= now().getTime()) {
      approval.status = "EXPIRADA";
      transition(task, "BLOQUEADA", timestamp(), "APPROVAL_EXPIRED");
      save(stateDir, state);
      return { status: "EXPIRED", reply: display(task) };
    }
    if (match[2] === "R") {
      approval.status = "REJEITADA";
      transition(task, "BLOQUEADA", timestamp(), "APPROVAL_REJECTED");
      save(stateDir, state);
      return { status: "REJECTED", reply: display(task) };
    }
    approval.status = "APROVADA";
    save(stateDir, state); // One-use decision persists before local execution.
    await execute(state, task);
    return { status: "APPROVED", reply: display(task), task };
  }
  function recordMonitorEvents(events) {
    if (!Array.isArray(events) || events.length > 200)
      throw new Error("TASK_EVENTS_INVALID");
    const state = load(stateDir);
    let matched = 0;
    let expired = 0;
    for (const task of state.tasks) {
      if (task.tool === "task_watch" && task.status === "PENDENTE" &&
          now().getTime() - Date.parse(task.watchAfter) >= WATCH_MS) {
        transition(task, "BLOQUEADA", timestamp(), "WATCH_EXPIRED");
        expired++;
      }
    }
    for (const event of events) {
      if (!UUID.test(event?.monitorId ?? "") ||
          !["NEW", "CHANGED"].includes(event.kind) ||
          !/^[A-Z0-9_]{3,80}$/.test(event.code ?? "") ||
          !Number.isFinite(Date.parse(event.observedAt ?? ""))) continue;
      for (const task of state.tasks) {
        if (task.tool !== "task_watch" || task.status !== "PENDENTE" ||
            Date.parse(event.observedAt) <= Date.parse(task.watchAfter) ||
            Date.parse(event.observedAt) > Date.parse(task.watchAfter) + WATCH_MS ||
            (task.studio && task.studio.toUpperCase().replace(/[ -]/g, "_") !==
              event.studioCode)) continue;
        task.evidence = { source: "MONITOR_EVENT", status: event.kind,
          observedAt: event.observedAt, causeStatus: "NAO_DETERMINADA",
          codes: [event.code], runIds: [], monitorId: event.monitorId,
          codeFiles: [], applied: false };
        transition(task, "CONCLUIDA", timestamp(), "MONITOR_EVENT_MATCHED");
        matched++;
      }
    }
    if (matched || expired) save(stateDir, state);
    return { matched, expired };
  }
  return Object.freeze({ recover, request, callback,
    recordMonitorEvents,
    read: () => load(stateDir), list: () => load(stateDir).tasks.slice(-20) });
}
