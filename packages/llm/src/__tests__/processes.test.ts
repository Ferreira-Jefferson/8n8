// Real processes, no mock (CC-19): the Claude Code processes 8n8 starts never
// outlive it. A host process plays 8n8 with the real provider and a stand-in
// Claude Code (fixtures/fake-claude.mjs), so this runs on any machine, with no
// login. The test kills the host as hard as closing its terminal does, then
// asks the operating system which processes are still alive.
import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HOST = fileURLToPath(
  new URL("./fixtures/claude-host.ts", import.meta.url),
);

/** Whether the operating system still has `pid`; signal 0 only checks. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

const started: { host: ChildProcess; pids: number[] }[] = [];

/** Starts the host and resolves with the pids it printed: [answered, waiting]. */
function startHost(
  env: Record<string, string> = {},
): Promise<{ host: ChildProcess; pids: number[] }> {
  return new Promise((resolve, reject) => {
    const host = spawn(process.execPath, ["--import", "tsx", HOST], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    host.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    host.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const m = /PIDS (\[[^\]]*\])/.exec(out);
      if (!m?.[1]) return;
      const run = { host, pids: JSON.parse(m[1]) as number[] };
      started.push(run);
      resolve(run);
    });
    host.on("exit", (code) =>
      reject(new Error(`o hospedeiro saiu com ${code}: ${err.slice(0, 400)}`)),
    );
  });
}

afterEach(() => {
  // Whatever a failing case left behind is ended here, so no run leaks a process.
  for (const { host, pids } of started.splice(0)) {
    if (host.pid && alive(host.pid)) host.kill("SIGKILL");
    for (const pid of pids) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
});

describe("the Claude Code processes 8n8 starts (CC-19)", () => {
  it("are two: the one that answered ends, the one for the next call waits", async () => {
    const { host, pids } = await startHost();
    expect(pids).toHaveLength(2);
    const [answered, waiting] = pids as [number, number];
    expect(await until(() => !alive(answered), 10_000)).toBe(true);
    expect(alive(waiting)).toBe(true);
    expect(host.pid && alive(host.pid)).toBe(true);
  }, 60_000);

  it("all end when 8n8 is killed hard, as when its terminal closes", async () => {
    const { host, pids } = await startHost();
    const [, waiting] = pids as [number, number];
    expect(alive(waiting)).toBe(true);
    host.kill("SIGKILL");
    expect(await until(() => pids.every((p) => !alive(p)), 10_000)).toBe(true);
  }, 60_000);

  it("the waiting one ends by itself after spareIdleMs, while 8n8 keeps running", async () => {
    const { host, pids } = await startHost({ SPARE_IDLE_MS: "300" });
    const [, waiting] = pids as [number, number];
    expect(await until(() => !alive(waiting), 10_000)).toBe(true);
    expect(host.pid && alive(host.pid)).toBe(true);
  }, 60_000);
});
