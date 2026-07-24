import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const viewports = (process.env.RESPONSIVE_AUDIT_WIDTHS ?? "320,390,768,1024,1440")
  .split(",")
  .map((item) => Number(item.trim()))
  .filter(Boolean);

const paths = (process.env.RESPONSIVE_AUDIT_PATHS ??
  [
    "/",
    "/login",
    "/signup",
    "/forgot-password",
    "/termos",
    "/privacidade",
    "/cookies",
    "/rgpd",
    "/politica-cancelamento",
    "/politica-reembolso",
    "/contacto",
    "/s/bellza",
    "/admin",
    "/admin/agenda",
    "/admin/clientes",
    "/admin/equipa",
    "/admin/horarios",
    "/admin/servicos",
    "/admin/pagamentos",
    "/admin/recebimento",
    "/admin/sinal",
    "/admin/marca",
    "/admin/balcao",
    "/admin/whatsapp",
    "/admin/politicas",
    "/admin/fidelidade",
    "/admin/indicacoes",
    "/admin/comissoes",
    "/admin/premium",
    "/admin/guia-rapido",
  ].join(","))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const previewPort = Number(process.env.RESPONSIVE_AUDIT_PORT ?? 4177);
const cdpPort = Number(process.env.RESPONSIVE_AUDIT_CDP_PORT ?? 9227);
const origin = process.env.RESPONSIVE_AUDIT_ORIGIN ?? `http://127.0.0.1:${previewPort}`;

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chromePath = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chromePath) {
  throw new Error(
    "Responsive audit requires Chrome/Chromium. Set CHROME_PATH to a headless Chrome binary.",
  );
}

const viteBin = join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) {
  throw new Error("Vite binary not found. Run npm install before responsive audit.");
}
const wranglerBin = join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);

const children = [];
const cleanup = () => {
  for (const child of children.reverse()) {
    if (child.killed) continue;
    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill();
    }
  }
};
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: options.stdio ?? "pipe",
    shell: options.shell ?? command.endsWith(".cmd"),
    windowsHide: true,
    ...options,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`[responsive-audit] failed to start ${command}:`, error.message);
  });
  return child;
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(350);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? ` (${lastError.message})` : ""}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      const listeners = this.events.get(message.method);
      if (listeners) listeners.forEach((listener) => listener(message));
    });
  }

  async ready() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15000).unref?.();
    });
  }

  once(method, predicate = () => true) {
    return new Promise((resolve) => {
      const listener = (message) => {
        if (!predicate(message)) return;
        const listeners = this.events.get(method) ?? [];
        this.events.set(
          method,
          listeners.filter((item) => item !== listener),
        );
        resolve(message);
      };
      this.events.set(method, [...(this.events.get(method) ?? []), listener]);
    });
  }

  close() {
    this.ws.close();
  }
}

const auditSource = String.raw`
async ({ path, width }) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (el.classList.contains("sr-only")) return false;
    if (el.closest("[aria-hidden='true'], .public-grid-bg")) return false;
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const selectorName = (el) => {
    const id = el.id ? "#" + el.id : "";
    const cls = String(el.className || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    return (el.tagName.toLowerCase() + id + (cls ? "." + cls : "")).slice(0, 140);
  };
  const runPass = async (label) => {
    await sleep(80);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;
    const body = document.body;
    const all = Array.from(document.querySelectorAll("body *")).filter(visible);
    const failures = [];
    const scrollWidth = Math.max(doc.scrollWidth, body?.scrollWidth || 0);
    if (scrollWidth > vw + 1) {
      failures.push({ type: "horizontal-overflow", detail: "scrollWidth " + scrollWidth + "px > viewport " + vw + "px" });
    }
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const isFixed = style.position === "fixed";
      const toleratedBleed = el.closest("[data-allow-viewport-bleed], .public-grid-bg") || style.position === "absolute";
      if (!isFixed && !toleratedBleed && (rect.left < -1 || rect.right > vw + 1)) {
        failures.push({ type: "element-outside-viewport", detail: selectorName(el) + " left=" + rect.left.toFixed(1) + " right=" + rect.right.toFixed(1) + " vw=" + vw });
      }
    }
    const textTargets = all.filter((el) => el.matches("button,a,[role='button'],h1,h2,h3,p,label,span,li,td,th"));
    for (const el of textTargets) {
      const style = getComputedStyle(el);
      const hasEllipsis = style.textOverflow === "ellipsis";
      const clipsX = el.scrollWidth > el.clientWidth + 2 && ["hidden", "clip"].includes(style.overflowX);
      const clipsY = el.scrollHeight > el.clientHeight + 2 && ["hidden", "clip"].includes(style.overflowY);
      if ((clipsX || clipsY) && !hasEllipsis && !el.closest("[data-allow-text-clip]")) {
        failures.push({ type: el.matches("button,[role='button']") ? "button-clipped" : "text-clipped", detail: selectorName(el) + " scroll=" + el.scrollWidth + "x" + el.scrollHeight + " client=" + el.clientWidth + "x" + el.clientHeight });
      }
    }
    const dialogs = all.filter((el) => el.matches("[role='dialog'],[data-radix-dialog-content]"));
    for (const el of dialogs) {
      const rect = el.getBoundingClientRect();
      if (rect.width > vw + 1 || rect.height > vh + 1 || rect.left < -1 || rect.top < -1) {
        failures.push({ type: "modal-outside-viewport", detail: selectorName(el) + " rect=" + rect.width.toFixed(1) + "x" + rect.height.toFixed(1) + " at " + rect.left.toFixed(1) + "," + rect.top.toFixed(1) + " viewport=" + vw + "x" + vh });
      }
    }
    const fixedBottom = all.filter((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.position === "fixed" && style.pointerEvents !== "none" && rect.bottom >= vh - 1 && rect.height > 24;
    });
    for (const footer of fixedBottom) {
      const rect = footer.getBoundingClientRect();
      if (rect.height > vh * 0.42) {
        failures.push({ type: "fixed-footer-too-tall", detail: selectorName(footer) + " height=" + rect.height.toFixed(1) + " viewport=" + vh });
      }
      const overlaps = all.filter((el) => {
        if (el === footer || footer.contains(el) || el.contains(footer)) return false;
        const style = getComputedStyle(el);
        if (style.position === "fixed" || style.position === "sticky") return false;
        if (el.closest("[aria-hidden='true']")) return false;
        const r = el.getBoundingClientRect();
        return r.height > 8 && r.width > 8 && r.bottom > rect.top + 2 && r.top < rect.bottom - 2;
      });
      const meaningful = overlaps.find((el) => el.matches("a,button,p,h1,h2,h3,label,footer,li"));
      if (meaningful) {
        failures.push({ type: "fixed-footer-overlap", detail: selectorName(footer) + " overlaps " + selectorName(meaningful) });
      }
    }
    return { label, failures };
  };
  window.scrollTo(0, 0);
  await sleep(120);
  const top = await runPass("top");
  window.scrollTo(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  await sleep(120);
  const bottom = await runPass("bottom");
  return {
    path,
    width,
    height: window.innerHeight,
    failures: [...top.failures, ...bottom.failures].slice(0, 30),
  };
}
`;

async function auditPage(client, path, width) {
  const target = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: width,
      screenHeight: 844,
    },
    sessionId,
  );
  const load = client.once(
    "Page.loadEventFired",
    (message) => message.sessionId === sessionId,
  );
  await client.send("Page.navigate", { url: `${origin}${path}` }, sessionId);
  await Promise.race([load, delay(8000)]);
  await delay(700);
  const result = await client.send(
    "Runtime.evaluate",
    {
      expression: `(${auditSource})(${JSON.stringify({ path, width })})`,
      awaitPromise: true,
      returnByValue: true,
    },
    sessionId,
  );
  await client.send("Target.closeTarget", { targetId: target.targetId });
  return result.result.value;
}

async function main() {
  console.log(`[responsive-audit] starting preview at ${origin}`);
  const wranglerConfig = join(process.cwd(), "dist", "server", "wrangler.json");
  const useWrangler = existsSync(wranglerConfig) && existsSync(wranglerBin);
  const previewOptions = process.env.RESPONSIVE_AUDIT_VERBOSE === "1" ? {} : { stdio: "ignore" };
  const preview = useWrangler
    ? startProcess(wranglerBin, [
        "dev",
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        String(previewPort),
        "--config",
        wranglerConfig,
      ], previewOptions)
    : startProcess(process.execPath, [
        viteBin,
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(previewPort),
      ], previewOptions);
  if (process.env.RESPONSIVE_AUDIT_VERBOSE === "1") {
    preview.stdout?.on("data", (data) => process.stdout.write(`[preview] ${data}`));
    preview.stderr?.on("data", (data) => process.stderr.write(`[preview] ${data}`));
  }
  await waitForHttp(origin);

  const userDataDir = mkdtempSync(join(tmpdir(), "bellza-responsive-audit-"));
  console.log(`[responsive-audit] launching Chrome at ${chromePath}`);
  startProcess(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${cdpPort}`,
    "about:blank",
  ]);
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const version = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
  const client = new CdpClient(version.webSocketDebuggerUrl);
  await client.ready();

  const failures = [];
  for (const width of viewports) {
    for (const path of paths) {
      const result = await auditPage(client, path, width);
      if (result.failures.length) {
        failures.push(result);
        console.error(
          `[responsive-audit] FAIL ${path} @ ${width}px\n` +
            result.failures.map((failure) => `  - ${failure.type}: ${failure.detail}`).join("\n"),
        );
      } else {
        console.log(`[responsive-audit] ok ${path} @ ${width}px`);
      }
    }
  }

  client.close();
  cleanup();
  await delay(300);
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Chrome can keep profile files locked for a moment on Windows; do not fail a clean audit for cleanup.
  }

  if (failures.length) {
    const count = failures.reduce((sum, item) => sum + item.failures.length, 0);
    throw new Error(`Responsive audit failed with ${count} issue(s) across ${failures.length} page/viewport checks.`);
  }
  console.log(`[responsive-audit] passed ${paths.length * viewports.length} checks`);
}

main().catch((error) => {
  cleanup();
  console.error(`[responsive-audit] ${error.message}`);
  process.exit(1);
});
