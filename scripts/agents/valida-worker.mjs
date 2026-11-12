import { runValida } from "../../agents/valida.mjs";

try {
  process.stdout.write(JSON.stringify(runValida()));
} catch {
  process.exitCode = 1;
}
