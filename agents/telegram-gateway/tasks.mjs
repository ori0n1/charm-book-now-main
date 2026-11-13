import { existsSync, mkdirSync, readFileSync, renameSync,
  statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const ACTIONS = Object.freeze({
  task_overview: { agent: "atlas", operation: "overview" },
  task_coordinate: { agent: "atlas", operation: "coordinate" },
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
const REUSE_MS = 15 * 60_000;
const COORDINATION_STEPS = 4;
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
  const confirmed = findings.length > 0 &&
    findings.every((item) => item.causeStatus === "CONFIRMADA");
  return {
    source: safe(result?.source ?? "INDISPONIVEL", 40),
    status: safe(result?.status ?? "INDETERMINADO", 40),
    observedAt: Number.isFinite(Date.parse(result?.observedAt ?? ""))
      ? result.observedAt : null,
    causeStatus: confirmed ? "CONFIRMADA" : "NAO_DETERMINADA",
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
    plan: typeof result?.plan === "string" ? safe(result.plan, 160) : null,
    patchProof: confirmed && result?.patchProof?.sourceVerified === true &&
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
const TEST_RELEVANT = /^(?:AGENDA|AVAILABILITY|BOOKING|RESERV|CLIENT|DUPLICATE|WHATSAPP|NOTIF|PAYMENT|STRIPE|PUBLIC|VISUAL|RESOURCE|HTTP)/;
function needsLocalTests(task) {
  return task?.evidence?.codes?.some((code) => TEST_RELEVANT.test(code)) ?? false;
}
function confirmedDiagnosis(task) {
  return task?.status === "CONCLUIDA" &&
    task.evidence?.status === "DIAGNOSTICADO" &&
    task.evidence?.causeStatus === "CONFIRMADA" &&
    task.evidence?.codes?.length > 0;
}
function issueText(code) {
  const known = {
    OFFICIAL_RECORD_OUTDATED:
      "Há uma divergência entre a referência oficial e a versão observada.",
    AUTH_UNAVAILABLE: "A leitura Cloudflare ficou indisponível.",
    AUTH_REJECTED: "A leitura Cloudflare foi rejeitada.",
    VISUAL_JS_ERROR: "Uma página apresentou erro de JavaScript.",
    PUBLIC_PAGE_HTTP_ERROR: "Uma página pública apresentou erro HTTP.",
    PUBLIC_ENDPOINT_UNAVAILABLE: "Um endereço público não respondeu.",
  };
  return known[code] ?? "O monitor registou uma anomalia.";
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
        const task = state.tasks.find((item) => item.id === approval.taskId);
        if (task?.status === "AGUARDANDO_APROVACAO") {
          transition(task, "BLOQUEADA", timestamp(), "APPROVAL_EXPIRED");
          const parent = state.tasks.find((item) => item.id === task.parentId);
          if (parent?.status === "AGUARDANDO_APROVACAO")
            transition(parent, "BLOQUEADA", timestamp(),
              "VALIDATION_APPROVAL_EXPIRED");
        }
        changed = true;
      }
    }
    for (const parent of state.tasks.filter((item) =>
      item.tool === "task_coordinate" &&
      item.status === "AGUARDANDO_APROVACAO")) {
      const child = (parent.childIds ?? []).map((id) =>
        state.tasks.find((item) => item.id === id))
        .find((item) => item?.tool === "task_validate");
      const approval = state.approvals.find((item) =>
        item.taskId === child?.id);
      if (approval?.status === "APROVADA") {
        transition(parent, "BLOQUEADA", timestamp(),
          "APPROVED_ACTION_INTERRUPTED");
        changed = true;
      }
    }
    if (changed) save(stateDir, state);
    return { blockedAfterRestart: state.tasks.filter((t) =>
      t.events.at(-1)?.code === "RESTART_REQUIRES_REVIEW").length };
  }
  async function execute(state, task, deadline = null) {
    const spec = ACTIONS[task.tool];
    if (state.tasks.some((t) => t.id !== task.id &&
        t.status === "EM_EXECUCAO" &&
        !(t.id === task.parentId && t.tool === "task_coordinate"))) {
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
      const duration = deadline === null ? DURATION_MS :
        Math.min(DURATION_MS, deadline - Date.now());
      if (duration <= 0) throw new Error("TASK_TIMEOUT");
      let timer;
      const result = await Promise.race([
        Promise.resolve().then(() => op({ studio: task.studio,
          hours: task.hours, taskId: task.id,
          dependencyId: task.dependencyId, proof: task.patchProof })),
        new Promise((_, reject) => { timer = setTimeout(() =>
          reject(new Error("TASK_TIMEOUT")), duration); }),
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
  function taskSummary(task) {
    const e = task.evidence;
    if (!e) {
      const reason = task.events.at(-1)?.code;
      return reason === "TASK_REFERENCE_NOT_FOUND" ?
        "Não encontrei a tarefa indicada. Nenhuma alteração foi realizada." :
        "Não consegui concluir este pedido. Nenhuma alteração foi realizada.";
    }
    const parts = [];
    if (e.source === "SYNTHETIC_LOCAL") parts.push("Simulação local.");
    if (task.agent === "sherlock") {
      if (e.codes?.length) parts.push(issueText(e.codes[0]));
      else parts.push("Não encontrei evidência suficiente para um diagnóstico.");
      parts.push(e.causeStatus === "CONFIRMADA" ?
        "A causa foi comprovada nas evidências." :
        "A causa ainda não foi comprovada.");
      if (e.sourcesUnavailable?.length)
        parts.push(`Falta: ${sources(e.sourcesUnavailable)}.`);
    } else if (task.agent === "forge") {
      if (e.plan) parts.push("Preparei um plano de investigação, sem aplicar patch.");
      else parts.push("Não há evidência suficiente para propor uma correção.");
      if (e.reason === "PATCH_PROOF_REQUIRED")
        parts.push("Falta comprovar a base do patch.");
    } else if (task.agent === "valida") {
      parts.push(e.status === "APPROVED" ?
        "Os testes sintéticos locais passaram." :
        e.status === "FAILED" ? "Os testes sintéticos locais falharam." :
          "Os testes sintéticos locais ficaram inconclusivos.");
    } else {
      parts.push(e.status === "ATENCAO" ?
        "A última monitorização requer atenção." :
        e.status === "INDETERMINADO" ?
          "A última monitorização ficou inconclusiva." :
          "Consultei o último relatório disponível.");
    }
    if (e.observedAt) {
      const stale = now().getTime() - Date.parse(e.observedAt) > 60 * 60_000;
      parts.push(`Obs. ${portugalTime(e.observedAt)} PT${stale ?
        "; dados antigos" : ""}.`);
    }
    parts.push("Nenhuma alteração foi aplicada.");
    return parts.join(" ");
  }
  function detailChunks(lines, id) {
    const chunks = [];
    let current = "";
    for (const line of lines) {
      if (current && current.length + line.length + 1 > 1100) {
        chunks.push(current);
        current = `Tarefa ${id} (continuação)`;
      }
      current += (current ? "\n" : "") + line;
    }
    if (current) chunks.push(current);
    return { detailMessage: chunks[0], detailMessages: chunks.slice(1) };
  }
  function taskDetails(task) {
    const e = task.evidence;
    const lines = [`Tarefa ${task.id}; agente ${task.agent}; estado ${task.status}`,
      `Dependência: ${task.dependencyId ?? "nenhuma"}`,
      "Sem patch, publicação ou escrita remota."];
    if (e) {
      lines.push(`Fonte ${e.source}; resultado ${e.status}; ` +
        `causa ${e.causeStatus}; observado ${e.observedAt ?
          portugalTime(e.observedAt) : "indisponível"} (Portugal)`);
      if (e.codes?.length) lines.push(`Códigos: ${e.codes.join(", ")}`);
      if (e.monitorId) lines.push(`Monitor: ${e.monitorId}`);
      if (e.runIds?.length) lines.push(`Relatórios: ${e.runIds.join(", ")}`);
      if (e.sourcesConsulted?.length)
        lines.push(`Fontes consultadas: ${e.sourcesConsulted.join(", ")}`);
      if (e.sourcesUnavailable?.length)
        lines.push(`Fontes indisponíveis: ${e.sourcesUnavailable.join(", ")}`);
      if (e.reason) lines.push(`Motivo: ${e.reason}`);
    } else lines.push(`Motivo: ${task.events.at(-1)?.code ?? "SEM_EVIDENCIA"}`);
    return detailChunks(lines, task.id);
  }
  const childrenOf = (state, parent) => (parent.childIds ?? [])
    .map((id) => state.tasks.find((item) => item.id === id))
    .filter(Boolean);
  function coordinationSummary(state, parent) {
    const children = childrenOf(state, parent);
    const sentinela = children.find((item) => item.agent === "sentinela");
    const sherlock = children.find((item) => item.agent === "sherlock");
    const valida = children.find((item) => item.agent === "valida");
    const forge = children.find((item) => item.agent === "forge");
    const evidence = sherlock?.evidence;
    const parts = ["Investigação Bellza."];
    if (evidence?.codes?.length) parts.push(issueText(evidence.codes[0]));
    else if (evidence?.status === "SEM_ANOMALIAS")
      parts.push("Não encontrei anomalias no último relatório disponível.");
    else parts.push("A última verificação não deu evidência suficiente.");
    if (sentinela?.status === "FALHOU" ||
        sentinela?.status === "BLOQUEADA")
      parts.push("A leitura da Sentinela falhou.");
    if (sherlock?.status === "FALHOU")
      parts.push("Sherlock não concluiu a consulta.");
    else if (sherlock?.status === "BLOQUEADA")
      parts.push("O diagnóstico ficou inconclusivo.");
    parts.push(confirmedDiagnosis(sherlock) ?
      (evidence?.source === "SYNTHETIC_LOCAL" ?
        "Causa comprovada apenas na simulação." :
        "Causa comprovada nas evidências.") :
      "Causa ainda não comprovada.");
    if (valida?.status === "AGUARDANDO_APROVACAO")
      parts.push("Testes locais aguardam sua aprovação.");
    else if (valida?.status === "CONCLUIDA")
      parts.push("Testes sintéticos passaram.");
    else if (valida?.status === "FALHOU")
      parts.push("Testes sintéticos falharam.");
    else if (valida?.status === "BLOQUEADA")
      parts.push("Testes locais não concluídos.");
    if (forge?.evidence?.plan)
      parts.push("Forge indicou um plano; patch bloqueado.");
    else if (forge) parts.push("Forge não preparou patch.");
    const lastCode = parent.events.at(-1)?.code;
    if (parent.status === "BLOQUEADA" &&
        ["TASK_LIMIT", "TASK_TIMEOUT", "COORDINATION_FAILED"]
          .includes(lastCode))
      parts.push("A coordenação parou por limite ou falha local.");
    const observed = evidence?.observedAt;
    if (Number.isFinite(Date.parse(observed ?? ""))) {
      const age = now().getTime() - Date.parse(observed);
      parts.push(`Obs. ${portugalTime(observed)} PT${age > 60 * 60_000 ?
        "; dados antigos" : ""}.`);
    } else parts.push("Sem data de verificação atual.");
    parts.push("Nenhuma alteração foi aplicada.");
    return parts.join(" ");
  }
  function coordinationDetails(state, parent, extraLine = null) {
    const lines = [`Atlas ${parent.id} — ${parent.status}`,
      "Sem patch, publicação ou escrita remota."];
    for (const child of childrenOf(state, parent)) {
      const e = child.evidence;
      lines.push(`${child.agent} ${child.id} — ${child.status}; ` +
        `depende de ${child.dependencyId ?? "nenhuma"}`);
      if (e) lines.push(`Fonte ${e.source}; estado ${e.status}; ` +
        `códigos ${e.codes?.join(", ") || "nenhum"}; ` +
        `observado ${e.observedAt ? portugalTime(e.observedAt) : "indisponível"} (Portugal)` +
        `${e.reason ? `; motivo ${e.reason}` : ""}`);
      if (child.reusedFromTaskId)
        lines.push(`Diagnóstico reutilizado de ${child.reusedFromTaskId}`);
      if (child.agent === "sherlock" && e?.monitorId)
        lines.push(`Execução monitor ${e.monitorId}; relatórios ` +
          (e.runIds?.join(", ") || "indisponíveis"));
      if (child.agent === "sherlock" && e?.sourcesConsulted?.length)
        lines.push(`Fontes consultadas: ${e.sourcesConsulted.join(", ")}`);
      if (child.agent === "sherlock" && e?.sourcesUnavailable?.length)
        lines.push(`Fontes indisponíveis: ${e.sourcesUnavailable.join(", ")}`);
    }
    if (extraLine) lines.push(extraLine);
    return detailChunks(lines, parent.id);
  }
  function detailsButton(parent) {
    return { inline_keyboard: [[{ text: "Ver detalhes",
      callback_data: `v:${parent.id}` }]] };
  }
  function addChild(state, parent, tool, dependencyId = null) {
    if (state.tasks.length >= MAX_TASKS ||
        state.tasks.filter((item) => item.createdAt.startsWith(
          timestamp().slice(0, 10))).length >= DAY_LIMIT)
      throw new Error("TASK_LIMIT");
    const child = { id: randomUUID(), source: `${parent.source}:${tool}`,
      tool, agent: ACTIONS[tool].agent, parentId: parent.id,
      studio: parent.studio, hours: parent.hours, dependencyId,
      dependencyExplicit: false, status: "PENDENTE",
      createdAt: timestamp(), updatedAt: timestamp(),
      events: [{ at: timestamp(), status: "PENDENTE", code: "CREATED" }],
      evidence: null, patchProof: null };
    state.tasks.push(child);
    parent.childIds.push(child.id);
    save(stateDir, state);
    return child;
  }
  async function finishCoordination(state, parent, deadline) {
    const children = childrenOf(state, parent);
    const sherlock = children.find((item) => item.agent === "sherlock");
    const valida = children.find((item) => item.agent === "valida");
    let coordinationError = null;
    if (confirmedDiagnosis(sherlock) &&
        (!valida || valida.status === "CONCLUIDA")) {
      try {
        if (Date.now() >= deadline) throw new Error("TASK_TIMEOUT");
        const forge = addChild(state, parent, "task_propose",
          sherlock.reusedFromTaskId ?? sherlock.id);
        await execute(state, forge, deadline);
      } catch (error) {
        coordinationError = /^[A-Z_]{3,50}$/.test(error?.message ?? "") ?
          error.message : "COORDINATION_FAILED";
      }
    }
    const failed = coordinationError || sherlock?.status === "FALHOU" ||
      sherlock?.status === "BLOQUEADA" ||
      (valida && valida.status !== "CONCLUIDA") ||
      childrenOf(state, parent).some((item) =>
        item.agent === "forge" && item.status === "FALHOU");
    const e = sherlock?.evidence;
    parent.evidence = { source: "LOCAL_COORDINATION",
      status: failed ? "INDETERMINADO" : e?.status ?? "INDETERMINADO",
      observedAt: e?.observedAt ?? null,
      causeStatus: e?.causeStatus ?? "NAO_DETERMINADA",
      codes: e?.codes ?? [], runIds: e?.runIds ?? [],
      monitorId: e?.monitorId ?? null, codeFiles: [], applied: false };
    transition(parent, failed ? "BLOQUEADA" : "CONCLUIDA", timestamp(),
      coordinationError ?? (failed ? "COORDINATION_INCOMPLETE" :
        "COORDINATION_COMPLETE"));
    save(stateDir, state);
    return { status: "HANDLED", task: parent,
      reply: coordinationSummary(state, parent),
      buttons: detailsButton(parent) };
  }
  async function coordinate(state, parent) {
    const deadline = Date.now() + DURATION_MS;
    try {
      const monitor = addChild(state, parent, "task_monitor");
      await execute(state, monitor, deadline);
      const sherlock = addChild(state, parent, "task_investigate", monitor.id);
      const reusable = UUID.test(monitor.evidence?.monitorId ?? "") ?
        [...state.tasks].reverse().find((item) =>
          item.id !== sherlock.id && item.tool === "task_investigate" &&
          item.status === "CONCLUIDA" &&
          item.evidence?.source === "MONITOR_HISTORY" &&
          item.studio === parent.studio &&
          item.evidence?.monitorId === monitor.evidence.monitorId &&
          item.evidence.sourcesConsulted?.includes("CURRENT_SENTINELA_REPORT") &&
          now().getTime() - Date.parse(item.updatedAt) >= 0 &&
          now().getTime() - Date.parse(item.updatedAt) <= REUSE_MS) : null;
      if (reusable) {
        sherlock.evidence = structuredClone(reusable.evidence);
        sherlock.reusedFromTaskId = reusable.reusedFromTaskId ?? reusable.id;
        transition(sherlock, "CONCLUIDA", timestamp(), "RECENT_EVIDENCE_REUSED");
        save(stateDir, state);
      } else await execute(state, sherlock, deadline);
      if (needsLocalTests(sherlock) && Date.now() >= deadline)
        throw new Error("TASK_TIMEOUT");
      if (needsLocalTests(sherlock) && Date.now() < deadline) {
        const valida = addChild(state, parent, "task_validate", sherlock.id);
        const approval = { id: randomUUID(), taskId: valida.id,
          agent: "valida", action: "RUN_LOCAL_SYNTHETIC_TESTS",
          status: "PENDENTE", createdAt: timestamp(),
          expiresAt: new Date(now().getTime() + TTL_MS).toISOString() };
        state.approvals.push(approval);
        transition(valida, "AGUARDANDO_APROVACAO", timestamp(),
          "LOCAL_APPROVAL_REQUIRED");
        transition(parent, "AGUARDANDO_APROVACAO", timestamp(),
          "VALIDATION_APPROVAL_REQUIRED");
        save(stateDir, state);
        const code = sherlock.evidence?.codes?.[0];
        return { status: "APPROVAL_REQUIRED", task: parent, approval,
          reply: `Investigação Bellza. ${code ? issueText(code) :
            "Evidência ainda incompleta."} ` +
            `${confirmedDiagnosis(sherlock) ?
              "Causa comprovada." : "Causa ainda não comprovada."} ` +
            `7 testes sintéticos locais aguardam aprovação ${approval.id} ` +
            `até ${portugalTime(approval.expiresAt)} (Portugal). ` +
            "Nenhuma alteração foi aplicada.",
          buttons: approvalButtons(approval.id) };
      }
      return await finishCoordination(state, parent, deadline);
    } catch (error) {
      transition(parent, "BLOQUEADA", timestamp(),
        /^[A-Z_]{3,50}$/.test(error?.message ?? "") ?
          error.message : "COORDINATION_FAILED");
      save(stateDir, state);
      return { status: "HANDLED", task: parent,
        reply: coordinationSummary(state, parent),
        buttons: detailsButton(parent) };
    }
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
    if (duplicate) return duplicate.tool === "task_coordinate" ?
      { status: "DUPLICATE", task: duplicate,
        reply: coordinationSummary(state, duplicate),
        buttons: detailsButton(duplicate) } :
      { status: "DUPLICATE", task: duplicate,
        reply: taskSummary(duplicate),
        buttons: detailsButton(duplicate) };
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
    if (tool === "task_coordinate") {
      if (state.tasks.length + COORDINATION_STEPS + 1 > MAX_TASKS ||
          state.tasks.filter((item) => item.createdAt.startsWith(day)).length +
            COORDINATION_STEPS + 1 > DAY_LIMIT)
        return { status: "TASK_LIMIT",
          reply: "Limite local de tarefas atingido." };
      const parent = { id: randomUUID(), source, tool,
        agent: "atlas", studio: studio ? safe(studio, 40) : null,
        hours, dependencyId: null, status: "EM_EXECUCAO",
        createdAt: timestamp(), updatedAt: timestamp(),
        events: [{ at: timestamp(), status: "PENDENTE", code: "CREATED" },
          { at: timestamp(), status: "EM_EXECUCAO",
            code: "COORDINATION_STARTED" }],
        evidence: null, childIds: [] };
      state.tasks.push(parent);
      save(stateDir, state);
      return coordinate(state, parent);
    }
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
      return { status: "HANDLED", task, reply: taskSummary(task),
        buttons: detailsButton(task) };
    }
    if (task.patchProof &&
        (now().getTime() - Date.parse(task.patchProof.verifiedAt) >
          60 * 60_000 ||
          Date.parse(task.patchProof.verifiedAt) > now().getTime())) {
      transition(task, "BLOQUEADA", timestamp(), "VERSION_PROOF_EXPIRED");
      save(stateDir, state);
      return { status: "HANDLED", task, reply: taskSummary(task),
        buttons: detailsButton(task) };
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
    return { status: "HANDLED", task, reply: taskSummary(task),
      buttons: detailsButton(task) };
  }
  async function callback({ botKey, data }) {
    const detailsMatch = /^v:([0-9a-f-]{36})$/.exec(data ?? "");
    if (detailsMatch) {
      if (!["atlas", "sentinela", "sherlock", "valida", "forge"].includes(botKey) ||
          !UUID.test(detailsMatch[1]))
        return { status: "REJECTED", reply: "Pedido inválido." };
      const state = load(stateDir);
      const task = state.tasks.find((item) =>
        item.id === detailsMatch[1] &&
        item.source.startsWith(`${botKey}:`));
      return task ? { status: "DETAILS", reply: "Detalhes enviados.",
        ...(task.tool === "task_coordinate" ?
          coordinationDetails(state, task) : taskDetails(task)) } :
        { status: "REJECTED", reply: "Tarefa não encontrada." };
    }
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
    const parent = state.tasks.find((item) => item.id === task.parentId &&
      item.tool === "task_coordinate");
    if (match[2] === "D") return { status: "DETAILS", reply:
      `Tarefa ${task.id}; agente ${task.agent}; ação ${approval.action}; ` +
      `escopo local, sem produção. Estado ${approval.status}. ` +
      `Expira ${portugalTime(approval.expiresAt)} (Portugal).`,
      ...(parent ? coordinationDetails(state, parent,
        `Aprovação ${approval.id}; escopo: testes sintéticos locais; ` +
        `risco: até 75 s de uso local; evidência: diagnóstico ` +
        `${(parent.childIds ?? []).map((id) => state.tasks.find((item) =>
          item.id === id)).find((item) => item?.agent === "sherlock")?.id ??
          "indisponível"}; expira ${portugalTime(approval.expiresAt)} ` +
        "(Portugal).") : {}) };
    if (approval.status !== "PENDENTE" ||
        task.status !== "AGUARDANDO_APROVACAO")
      return { status: "REPLAY", reply: "Aprovação já usada ou encerrada." };
    if (Date.parse(approval.expiresAt) <= now().getTime()) {
      approval.status = "EXPIRADA";
      transition(task, "BLOQUEADA", timestamp(), "APPROVAL_EXPIRED");
      if (parent?.status === "AGUARDANDO_APROVACAO")
        transition(parent, "BLOQUEADA", timestamp(),
          "VALIDATION_APPROVAL_EXPIRED");
      save(stateDir, state);
      return { status: "EXPIRED", reply: taskSummary(task),
        ...(parent ? { followupMessage: coordinationSummary(state, parent) } : {}) };
    }
    if (match[2] === "R") {
      approval.status = "REJEITADA";
      transition(task, "BLOQUEADA", timestamp(), "APPROVAL_REJECTED");
      if (parent?.status === "AGUARDANDO_APROVACAO")
        transition(parent, "BLOQUEADA", timestamp(),
          "VALIDATION_APPROVAL_REJECTED");
      save(stateDir, state);
      return { status: "REJECTED", reply: taskSummary(task),
        ...(parent ? { followupMessage: coordinationSummary(state, parent) } : {}) };
    }
    approval.status = "APROVADA";
    save(stateDir, state); // One-use decision persists before local execution.
    await execute(state, task);
    if (parent?.status === "AGUARDANDO_APROVACAO") {
      transition(parent, "EM_EXECUCAO", timestamp(), "VALIDATION_DECIDED");
      save(stateDir, state);
      const result = await finishCoordination(state, parent,
        Date.now() + DURATION_MS);
      return { status: "APPROVED", reply: taskSummary(task), task,
        followupMessage: result.reply };
    }
    return { status: "APPROVED", reply: taskSummary(task), task };
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
  let operationQueue = Promise.resolve();
  const exclusive = (operation) => {
    const result = operationQueue.then(operation);
    operationQueue = result.catch(() => {});
    return result;
  };
  return Object.freeze({ recover,
    request: (args) => exclusive(() => request(args)),
    callback: (args) => exclusive(() => callback(args)),
    recordMonitorEvents: (events) =>
      exclusive(() => recordMonitorEvents(events)),
    read: () => load(stateDir), list: () => load(stateDir).tasks.slice(-20) });
}
