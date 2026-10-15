import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The registered provider, with node:child_process replaced: the real deps must run
// the executable with no shell, in the provider's own empty folder (CC-03, CC-04).
const spawned = vi.hoisted(
  () =>
    [] as {
      command: string;
      args: string[];
      options: Record<string, unknown>;
    }[],
);
vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  return {
    spawn: (
      command: string,
      args: string[],
      options: Record<string, unknown>,
    ) => {
      spawned.push({ command, args, options });
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(),
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => true,
      });
      child.stdin.on("finish", () => {
        child.stdout.write(
          JSON.stringify({ type: "result", is_error: false, result: "ok" }),
        );
        setImmediate(() => child.emit("close", 0));
      });
      return child;
    },
  };
});

const { claudeCode } = await import("../claude-code");

describe("the registered claude-code provider, real deps (CC-03, CC-04)", () => {
  it("spawns without a shell, hidden, in <tmp>/8n8-claude, which it creates", async () => {
    const client = claudeCode.create(
      {
        provider: "claude-code",
        apiKey: undefined,
        baseURL: undefined,
        model: "sonnet",
        reviewModel: "sonnet",
      },
      { env: { APP8N8_CLAUDE_PATH: process.execPath } },
    );
    const text = await client.complete({
      model: "sonnet",
      messages: [{ role: "user", content: "def f(): pass" }],
      json: "native",
    });
    expect(text).toBe("ok");
    expect(spawned).toHaveLength(1);
    const [run] = spawned;
    expect(run?.command).toBe(process.execPath);
    expect(run?.options.shell).toBe(false);
    expect(run?.options.windowsHide).toBe(true);
    const workDir = join(tmpdir(), "8n8-claude");
    expect(run?.options.cwd).toBe(workDir);
    expect(run?.options.cwd).not.toBe(process.cwd());
    expect(existsSync(workDir)).toBe(true);
  });
});
