// `pnpm dev`: the server and the Vite screen with one fresh session token, so the
// Vite proxy can call the API (DIST-20). Open the address Vite prints.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const env = { ...process.env, APP8N8_TOKEN: randomBytes(32).toString("hex") };
// pnpm on Windows may be a .cmd shim, which needs a shell: each command is one fixed
// string, with no argument for the shell to join.
const children = ["pnpm run dev:server", "pnpm run dev:web"].map((command) =>
  spawn(command, { env, stdio: "inherit", shell: true }),
);

const stop = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
}
