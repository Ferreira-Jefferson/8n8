// `pnpm dev`: the server and the Vite screen with one fresh session token, so the
// Vite proxy can call the API (DIST-20). Open the address Vite prints.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const env = { ...process.env, APP8N8_TOKEN: randomBytes(32).toString("hex") };
// pnpm on Windows may be a .cmd shim; the arguments are fixed, so a shell is safe here.
const shell = process.platform === "win32";

const children = ["dev:server", "dev:web"].map((script) =>
  spawn("pnpm", ["run", script], { env, stdio: "inherit", shell }),
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
