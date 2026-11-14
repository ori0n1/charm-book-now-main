import { basename, isAbsolute, resolve } from "node:path";

// The scheduled monitor must append to the state directory already read by
// the Telegram gateway. A missing or unexpected path fails closed.
export function requireSharedMonitorStateDir(config) {
  const path = config?.monitorStateDir;
  if (typeof path !== "string" || !isAbsolute(path) ||
      basename(path) !== ".bellza-agent-state" ||
      path !== resolve(path)) throw new Error("MONITOR_STATE_CONFIG_INVALID");
  return path;
}
