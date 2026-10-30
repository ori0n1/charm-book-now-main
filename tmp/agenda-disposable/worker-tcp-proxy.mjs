import net from "node:net";
import { spawn } from "node:child_process";

const server = net.createServer((incoming) => {
  const outgoing = net.createConnection(57921, "host.docker.internal");
  incoming.on("error", () => outgoing.destroy());
  outgoing.on("error", () => incoming.destroy());
  incoming.pipe(outgoing).pipe(incoming);
});

server.listen(57921, "127.0.0.1", () => {
  const worker = spawn(process.execPath, process.argv.slice(2), { stdio: "inherit" });
  worker.on("exit", (code) => {
    server.close();
    process.exitCode = code ?? 1;
  });
  process.on("SIGTERM", () => worker.kill("SIGTERM"));
});
