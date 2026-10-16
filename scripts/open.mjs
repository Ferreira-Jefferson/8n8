// Abre o 8n8 numa pasta. Uso: pnpm open [pasta] (constrói o CLI antes).
// A pasta relativa vale a partir de onde você digitou o comando (INIT_CWD), não da raiz do repositório.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.execPath,
  [
    `--env-file-if-exists=${join(root, ".env")}`,
    join(root, "apps", "cli", "dist", "8n8.mjs"),
    ...process.argv.slice(2),
  ],
  { cwd: process.env.INIT_CWD || process.cwd(), stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
