import { mkdirSync, openSync, closeSync, readFileSync,
  writeFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export function readSingleton(stateDir) {
  try {
    const value = JSON.parse(readFileSync(join(stateDir, "gateway.lock"), "utf8"));
    return Number.isSafeInteger(value.pid) && typeof value.nonce === "string"
      ? value : null;
  } catch { return null; }
}

export function acquireSingleton(stateDir, pid = process.pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("LOCK_INVALID");
  mkdirSync(stateDir, { recursive: true });
  const path = join(stateDir, "gateway.lock");
  let fd;
  try { fd = openSync(path, "wx", 0o600); }
  catch { throw new Error("GATEWAY_ALREADY_LOCKED"); }
  const identity = { pid, nonce: randomUUID(),
    startedAt: new Date().toISOString() };
  try { writeFileSync(fd, `${JSON.stringify(identity)}\n`); }
  catch { try { unlinkSync(path); } catch { /* fail closed */ }
    throw new Error("LOCK_WRITE_FAILED"); }
  finally { closeSync(fd); }
  return () => {
    const current = readSingleton(stateDir);
    if (current?.nonce !== identity.nonce) return false;
    try { unlinkSync(path); return true; }
    catch { return false; }
  };
}
