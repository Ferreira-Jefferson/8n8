// Plays 8n8 for the process test (CC-19): the real claude-code provider, with
// fake-claude.mjs in place of Claude Code. It asks once, prints the pids of the
// processes the provider started (the one that answered, then the one that
// waits for the next call) and stays up until it is killed.
import { fileURLToPath } from "node:url";
import { createClaudeCodeProvider, REAL_DEPS } from "../../claude-code";

const FAKE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
const pids: number[] = [];

const provider = createClaudeCodeProvider({
  ...REAL_DEPS,
  spareIdleMs: Number(process.env.SPARE_IDLE_MS ?? REAL_DEPS.spareIdleMs),
  // The executable is this Node, with the stand-in script before the provider's arguments.
  spawn: (_command, args, options) => {
    const child = REAL_DEPS.spawn(process.execPath, [FAKE, ...args], options);
    if (child.pid) pids.push(child.pid);
    return child;
  },
});

const client = provider.create(
  {
    provider: "claude-code",
    apiKey: undefined,
    baseURL: undefined,
    model: "sonnet",
    reviewModel: "sonnet",
  },
  { env: { ...process.env, APP8N8_CLAUDE_PATH: process.execPath } },
);

const answer = await client.complete({
  model: "sonnet",
  messages: [
    { role: "system", content: "S" },
    { role: "user", content: "def f(): pass" },
  ],
  json: "native",
});
console.log(`ANSWER ${answer}`);
console.log(`PIDS ${JSON.stringify(pids)}`);
// Up until killed, like the 8n8 server.
setInterval(() => {}, 1 << 30);
