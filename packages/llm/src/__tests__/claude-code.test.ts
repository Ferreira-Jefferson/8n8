import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { ChatMessage } from "@8n8/model";
import { afterAll, describe, expect, it } from "vitest";
import {
  type ClaudeCodeDeps,
  claudeArgs,
  claudeCode,
  conversationText,
  createClaudeCodeProvider,
  findClaude,
  isClaudeName,
  LIMITS,
  locateClaude,
} from "../claude-code";
import { createLlmClient } from "../providers";

const EXE = "C:\\claude\\claude.exe";
const config = {
  provider: "claude-code",
  apiKey: undefined,
  baseURL: undefined,
  model: "sonnet",
  reviewModel: "sonnet",
};

/** What one fake run saw, and how it answers. */
interface Run {
  command: string;
  args: string[];
  options: Parameters<ClaudeCodeDeps["spawn"]>[2];
  stdin: string;
  killed: boolean;
  /** Ends the fake process, as when it dies on its own. */
  close: (code: number) => void;
}

type Answer =
  | { exit: number; stdout?: string; stderr?: string }
  | { error: true }
  | { never: true }
  | { flood: number };

/** Deps with a fake spawn that records each run and answers as told. */
function fake(answer: Answer, over: Partial<ClaudeCodeDeps> = {}) {
  const runs: Run[] = [];
  const deps: ClaudeCodeDeps = {
    spawn: (command, args, options) => {
      const child = new EventEmitter() as ReturnType<ClaudeCodeDeps["spawn"]>;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const run: Run = {
        command,
        args,
        options,
        stdin: "",
        killed: false,
        close: (code) => child.emit("close", code),
      };
      runs.push(run);
      // Each line is one stream-json user message; the fake answers the first.
      let lines = "";
      stdin.on("data", (c: Buffer) => {
        lines += c.toString("utf8");
        const end = lines.indexOf("\n");
        if (end < 0 || run.stdin) return;
        run.stdin = JSON.parse(lines.slice(0, end)).message.content;
        answerWith();
      });
      Object.assign(child, {
        stdin,
        stdout,
        stderr,
        kill: () => {
          run.killed = true;
          return true;
        },
      });
      const answerWith = () => {
        if ("error" in answer) {
          child.emit("error", new Error("spawn ENOENT"));
        } else if ("flood" in answer) {
          stdout.write(Buffer.alloc(answer.flood, 120));
        } else if ("exit" in answer) {
          if (answer.stderr) stderr.write(answer.stderr);
          if (answer.stdout) stdout.write(`${answer.stdout}\n`);
          setImmediate(() => child.emit("close", answer.exit));
        }
      };
      return child;
    },
    isFile: (path) => path === EXE,
    workDir: () => "C:\\tmp\\8n8-claude",
    platform: "win32",
    home: "C:\\Users\\u",
    timeoutMs: 1000,
    maxOutputBytes: 1024,
    // No waiting processes unless a test asks for them (CC-13).
    maxSpares: 0,
    spareIdleMs: 60_000,
    ...over,
  };
  return { deps, runs };
}

const env = { APP8N8_CLAUDE_PATH: EXE, USERPROFILE: "C:\\Users\\u" };
const MESSAGES: ChatMessage[] = [
  { role: "system", content: "Você explica código." },
  { role: "user", content: "Código:\n1 | def f():" },
];
const ok = (result: string) =>
  [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "result", is_error: false, result }),
  ].join("\n");

const ask = (
  deps: ClaudeCodeDeps,
  messages = MESSAGES,
  e: Record<string, string | undefined> = env,
) =>
  createClaudeCodeProvider(deps)
    .create(config, { env: e })
    .complete({ model: "sonnet", messages, json: "native" });

describe("the claude-code provider (CC-01)", () => {
  it("is registered with the claude-sonnet-5-5 default and no key", () => {
    expect(claudeCode.id).toBe("claude-code");
    expect(claudeCode.defaultModel).toBe("claude-sonnet-5-5");
    expect(claudeCode.usesKey).toBe(false);
  });

  it("is configured only when the executable exists", () => {
    const { deps } = fake({ exit: 0 });
    const provider = createClaudeCodeProvider(deps);
    expect(provider.isConfigured(config, { env })).toBe(true);
    expect(
      provider.isConfigured(config, { env: { APP8N8_CLAUDE_PATH: "C:\\x" } }),
    ).toBe(false);
    expect(provider.isConfigured(config, {})).toBe(false);
  });
});

describe("locateClaude (CC-02)", () => {
  const base = { platform: "win32" as const, home: "C:\\Users\\u" };

  it("uses APP8N8_CLAUDE_PATH when it names a file, and nothing else when it does not", () => {
    const isFile = (p: string) => p === EXE || p.endsWith("claude.exe");
    expect(locateClaude({ APP8N8_CLAUDE_PATH: EXE }, { ...base, isFile })).toBe(
      EXE,
    );
    expect(
      locateClaude(
        { APP8N8_CLAUDE_PATH: "C:\\nada", APPDATA: "C:\\AppData" },
        { ...base, isFile },
      ),
    ).toBeUndefined();
  });

  it("finds the npm install under APPDATA on Windows, whatever the case of the name", () => {
    const npm = join(
      "C:\\AppData",
      "npm",
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    expect(
      locateClaude(
        { AppData: "C:\\AppData" },
        { ...base, isFile: (p) => p === npm },
      ),
    ).toBe(npm);
  });

  it("finds the native install in ~/.local/bin on Windows", () => {
    const native = join("C:\\Users\\u", ".local", "bin", "claude.exe");
    expect(locateClaude({}, { ...base, isFile: (p) => p === native })).toBe(
      native,
    );
  });

  it("searches the PATH, then ~/.local/bin and ~/.claude/local outside Windows", () => {
    const posix = { platform: "linux" as const, home: "/home/u" };
    const inPath = join("/opt/b", "claude");
    expect(
      locateClaude(
        {
          PATH: ["/usr/a", "/opt/b"].join(
            process.platform === "win32" ? ";" : ":",
          ),
        },
        { ...posix, isFile: (p) => p === inPath },
      ),
    ).toBe(inPath);
    const local = join("/home/u", ".claude", "local", "claude");
    expect(locateClaude({}, { ...posix, isFile: (p) => p === local })).toBe(
      local,
    );
    expect(locateClaude({}, { ...posix, isFile: () => false })).toBeUndefined();
  });
});

describe("findClaude (CC-16, CC-17)", () => {
  const base = { platform: "win32" as const, home: "C:\\Users\\u" };
  const PICKED = "D:\\tools\\claude.exe";
  const npmIn = (dir: string) =>
    join(
      dir,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );

  it("says where the executable came from: the variable, the dialog or the install places", () => {
    const isFile = (p: string) => [EXE, PICKED].includes(p);
    expect(
      findClaude({ APP8N8_CLAUDE_PATH: EXE }, { ...base, isFile }, PICKED),
    ).toEqual({ path: EXE, source: "env", envInvalid: false });
    expect(findClaude({}, { ...base, isFile }, PICKED)).toEqual({
      path: PICKED,
      source: "picked",
      envInvalid: false,
    });
    const native = join("C:\\Users\\u", ".local", "bin", "claude.exe");
    expect(findClaude({}, { ...base, isFile: (p) => p === native })).toEqual({
      path: native,
      source: "auto",
      envInvalid: false,
    });
  });

  it("with a wrong variable, uses the picked file or finds nothing, and says the variable is wrong", () => {
    const native = join("C:\\Users\\u", ".local", "bin", "claude.exe");
    const isFile = (p: string) => [PICKED, native].includes(p);
    const env = { APP8N8_CLAUDE_PATH: "C:\\nada\\claude.exe" };
    expect(findClaude(env, { ...base, isFile }, PICKED)).toEqual({
      path: PICKED,
      source: "picked",
      envInvalid: true,
    });
    expect(findClaude(env, { ...base, isFile })).toEqual({
      path: undefined,
      source: undefined,
      envInvalid: true,
    });
  });

  it("skips a picked file that is gone and goes on to the install places", () => {
    const native = join("C:\\Users\\u", ".local", "bin", "claude.exe");
    expect(
      findClaude({}, { ...base, isFile: (p) => p === native }, PICKED).path,
    ).toBe(native);
  });

  // The PATH is split by the host's delimiter: with C:\ paths, only on Windows.
  it.skipIf(process.platform !== "win32")(
    "on Windows, finds claude.exe in a PATH folder, or the package beside an npm claude.cmd",
    () => {
      const sep = ";";
      const PATH = ["C:\\bin", "C:\\nvm\\v22"].join(sep);
      const inBin = join("C:\\bin", "claude.exe");
      expect(
        locateClaude({ PATH }, { ...base, isFile: (p) => p === inBin }),
      ).toBe(inBin);
      const shim = npmIn("C:\\nvm\\v22");
      expect(
        locateClaude({ Path: PATH }, { ...base, isFile: (p) => p === shim }),
      ).toBe(shim);
    },
  );

  it("prefers the npm install under APPDATA and the native installer to the PATH", () => {
    const sep = process.platform === "win32" ? ";" : ":";
    const native = join("C:\\Users\\u", ".local", "bin", "claude.exe");
    const inBin = join("C:\\bin", "claude.exe");
    expect(
      locateClaude(
        { PATH: ["C:\\bin"].join(sep) },
        { ...base, isFile: (p) => p === native || p === inBin },
      ),
    ).toBe(native);
  });

  it("accepts as picked only a file named claude or claude.exe", () => {
    expect(isClaudeName("D:\\tools\\claude.exe")).toBe(true);
    expect(isClaudeName("D:\\tools\\CLAUDE.EXE")).toBe(true);
    expect(isClaudeName("/usr/local/bin/claude")).toBe(true);
    expect(isClaudeName("D:\\tools\\calc.exe")).toBe(false);
    expect(isClaudeName("D:\\tools\\claude.exe.bat")).toBe(false);
    expect(isClaudeName("D:\\claude\\x.exe")).toBe(false);
  });

  it("runs the picked file the config carries", async () => {
    const { deps, runs } = fake(
      { exit: 0, stdout: ok("{}") },
      { isFile: (p) => p === PICKED },
    );
    const provider = createClaudeCodeProvider(deps);
    const picked = { ...config, claudePath: PICKED };
    expect(provider.isConfigured(picked, { env: {} })).toBe(true);
    expect(provider.isConfigured(config, { env: {} })).toBe(false);
    await provider
      .create(picked, { env: {} })
      .complete({ model: "sonnet", messages: MESSAGES, json: "native" });
    expect(runs[0]?.command).toBe(PICKED);
  });
});

describe("one call (CC-03, CC-04, CC-05, CC-06)", () => {
  it("runs the executable without a shell, with the arguments as a list and the system prompt as one", async () => {
    const { deps, runs } = fake({ exit: 0, stdout: ok("{}") });
    await ask(deps);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run?.command).toBe(EXE);
    expect(run?.args).toEqual([
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "sonnet",
      "--effort",
      "low",
      "--system-prompt",
      "Você explica código.",
      "--tools",
      "",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
    ]);
    expect(run?.options.shell).toBe(false);
    expect(run?.options.windowsHide).toBe(true);
    expect(run?.args).not.toContain("--bare");
  });

  it("sends the code through stdin and never as an argument", async () => {
    const { deps, runs } = fake({ exit: 0, stdout: ok("{}") });
    await ask(deps);
    expect(runs[0]?.stdin).toBe("Código:\n1 | def f():");
    expect(runs[0]?.args.join(" ")).not.toContain("def f()");
  });

  it("runs in its own empty folder, never in the analysed one", async () => {
    const { deps, runs } = fake({ exit: 0, stdout: ok("{}") });
    await ask(deps);
    expect(runs[0]?.options.cwd).toBe("C:\\tmp\\8n8-claude");
  });

  it("drops the keys of the other providers from the environment, and keeps the rest", async () => {
    const { deps, runs } = fake({ exit: 0, stdout: ok("{}") });
    await ask(deps, MESSAGES, {
      ...env,
      OPENROUTER_API_KEY: "sk-or-x",
      app8n8_llm_api_key: "sk-y",
      ANTHROPIC_MODEL: "m",
    });
    const childEnv = runs[0]?.options.env ?? {};
    expect(Object.keys(childEnv).sort()).toEqual(
      ["ANTHROPIC_MODEL", "APP8N8_CLAUDE_PATH", "USERPROFILE"].sort(),
    );
  });

  it("returns the result of a successful answer", async () => {
    const { deps } = fake({ exit: 0, stdout: ok('```json\n{"ok":true}\n```') });
    expect(await ask(deps)).toBe('```json\n{"ok":true}\n```');
  });

  it.each([
    [
      { exit: 1, stdout: "Prompt: def f()", stderr: "erro em def f()" },
      "O Claude Code falhou (código 1).",
    ],
    [
      { exit: 0, stdout: "não é JSON com def f()" },
      "O Claude Code respondeu um formato desconhecido.",
    ],
    [
      { exit: 0, stdout: JSON.stringify({ is_error: false }) },
      "O Claude Code respondeu um formato desconhecido.",
    ],
    [
      {
        exit: 0,
        stdout: JSON.stringify({
          type: "result",
          is_error: true,
          subtype: "error_max_turns",
          result: "def f()",
        }),
      },
      "O Claude Code recusou o pedido: error_max_turns.",
    ],
    [
      {
        exit: 0,
        stdout: JSON.stringify({
          type: "result",
          is_error: true,
          subtype: "Código: def f()",
        }),
      },
      "O Claude Code recusou o pedido: erro.",
    ],
    [{ error: true }, "O Claude Code não abriu."],
  ] as const)(
    "fails with a short message and no raw output (%j)",
    async (answer, message) => {
      const { deps } = fake(answer as Answer);
      await expect(ask(deps)).rejects.toThrow(message);
      await ask(deps).catch((e: Error) => {
        expect(e.message).not.toContain("def f()");
      });
    },
  );

  it("fails when the executable is gone at call time", async () => {
    const { deps } = fake({ exit: 0 }, { isFile: () => false });
    await expect(ask(deps)).rejects.toThrow(
      "O Claude Code não foi encontrado.",
    );
  });
});

describe("limits (CC-07)", () => {
  it("kills a process that does not answer in time", async () => {
    const { deps, runs } = fake({ never: true }, { timeoutMs: 20 });
    const started = Date.now();
    await expect(ask(deps)).rejects.toThrow(
      "O Claude Code não respondeu em 0 s.",
    );
    // The timer fires at the given limit, not much later.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(runs[0]?.killed).toBe(true);
  });

  it("kills a process that answers more than the limit", async () => {
    const { deps, runs } = fake({ flood: 4096 }, { maxOutputBytes: 1024 });
    await expect(ask(deps)).rejects.toThrow("O Claude Code respondeu demais.");
    expect(runs[0]?.killed).toBe(true);
  });

  it("uses 180 s, 5 MB, 2 waiting processes and 10 min in the real provider", () => {
    expect(LIMITS).toEqual({
      timeoutMs: 180_000,
      maxOutputBytes: 5 * 1024 * 1024,
      maxSpares: 2,
      spareIdleMs: 10 * 60_000,
    });
  });
});

describe("processes started ahead (CC-13)", () => {
  const OTHER: ChatMessage[] = [
    { role: "system", content: "Você revisa." },
    { role: "user", content: "Afirmações: ..." },
  ];
  const client = (deps: ClaudeCodeDeps) =>
    createClaudeCodeProvider(deps).create(config, { env });
  const call = (c: ReturnType<typeof client>, messages = MESSAGES) =>
    c.complete({ model: "sonnet", messages, json: "native" });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("answers one request per process and stops it after the answer", async () => {
    const { deps, runs } = fake({ exit: 0, stdout: ok("{}") });
    await ask(deps);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.killed).toBe(true);
  });

  it("starts the next process of the same kind with the call, and the next call takes it", async () => {
    const { deps, runs } = fake(
      { exit: 0, stdout: ok("{}") },
      { maxSpares: 4 },
    );
    const c = client(deps);
    await call(c);
    expect(runs).toHaveLength(2);
    expect(runs[1]?.stdin).toBe("");
    expect(runs[1]?.args).toEqual(runs[0]?.args);
    await call(c);
    expect(runs[1]?.stdin).toBe("Código:\n1 | def f():");
    expect(runs).toHaveLength(3);
  });

  it("does not give a process to a call with another model or system prompt", async () => {
    const { deps, runs } = fake(
      { exit: 0, stdout: ok("{}") },
      { maxSpares: 4 },
    );
    const c = client(deps);
    await call(c);
    await call(c, OTHER);
    expect(runs[1]?.stdin).toBe("");
    expect(runs[2]?.stdin).toBe("Afirmações: ...");
    expect(runs[2]?.args).toContain("Você revisa.");
  });

  it("keeps at most maxSpares waiting processes, and stops the oldest", async () => {
    const { deps, runs } = fake(
      { exit: 0, stdout: ok("{}") },
      { maxSpares: 1 },
    );
    const c = client(deps);
    await call(c);
    await call(c, OTHER);
    // runs: 0 asked, 1 waiting (first kind), 2 asked, 3 waiting (other kind).
    expect(runs[1]?.killed).toBe(true);
    expect(runs[3]?.killed).toBe(false);
  });

  it("stops a waiting process that no call takes in spareIdleMs", async () => {
    const { deps, runs } = fake(
      { exit: 0, stdout: ok("{}") },
      { maxSpares: 4, spareIdleMs: 10 },
    );
    await call(client(deps));
    expect(runs[1]?.killed).toBe(false);
    await wait(40);
    expect(runs[1]?.killed).toBe(true);
  });

  it("starts a new process when the waiting one already died", async () => {
    const { deps, runs } = fake(
      { exit: 0, stdout: ok('{"ok":1}') },
      { maxSpares: 4 },
    );
    const c = client(deps);
    await call(c);
    runs[1]?.close(1);
    expect(await call(c)).toBe('{"ok":1}');
    expect(runs[1]?.stdin).toBe("");
    expect(runs[2]?.stdin).toBe("Código:\n1 | def f():");
  });

  it("counts the time limit from the request, not from the start of the process", async () => {
    const { deps } = fake(
      { exit: 0, stdout: ok("{}") },
      { maxSpares: 4, timeoutMs: 20 },
    );
    const c = client(deps);
    await call(c);
    await wait(40);
    expect(await call(c)).toBe("{}");
  });
});

describe("the conversation through stdin (CC-08)", () => {
  it("sends one message as it is", () => {
    expect(conversationText(MESSAGES)).toBe("Código:\n1 | def f():");
  });

  it("marks each turn of a new-draft request, in order", () => {
    expect(
      conversationText([
        { role: "system", content: "S" },
        { role: "user", content: "Código: x" },
        { role: "assistant", content: '{"summary":"a"}' },
        { role: "user", content: "Problemas encontrados: ..." },
      ]),
    ).toBe(
      'Pedido:\nCódigo: x\n\nSua resposta anterior:\n{"summary":"a"}\n\nPedido:\nProblemas encontrados: ...',
    );
  });

  it("refuses a model that would read as a flag", () => {
    expect(() => claudeArgs("--bare", "S")).toThrow(
      "Modelo inválido para o Claude Code.",
    );
  });

  it("starts no process for a model that would read as a flag", async () => {
    const { deps, runs } = fake({ exit: 0, stdout: ok("{}") });
    await expect(
      createClaudeCodeProvider(deps)
        .create(config, { env })
        .complete({ model: "--bare", messages: MESSAGES, json: "native" }),
    ).rejects.toThrow("Modelo inválido para o Claude Code.");
    expect(runs).toEqual([]);
  });

  it("leaves --system-prompt out when there is no system message", () => {
    expect(claudeArgs("haiku", "")).not.toContain("--system-prompt");
  });
});

describe("createLlmClient with claude-code (CC-02)", () => {
  it("builds no client without the executable, so the pipeline answers no-key", () => {
    expect(
      createLlmClient(config, { env: { APP8N8_CLAUDE_PATH: "C:\\nada" } }),
    ).toBeUndefined();
  });
});

// A real call to the user's Claude Code, only when asked: it spends the subscription.
describe.skipIf(process.env.APP8N8_CLAUDE_SMOKE !== "1")(
  "the real Claude Code (APP8N8_CLAUDE_SMOKE=1)",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "8n8-claude-smoke-"));
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it("answers a JSON request in print mode", async () => {
      const client = claudeCode.create(config, { env: process.env });
      const text = await client.complete({
        model: "haiku",
        messages: [
          { role: "system", content: "Você responde só JSON." },
          { role: "user", content: 'Responda só com o JSON {"ok":true}.' },
        ],
        json: "native",
      });
      expect(text).toContain('"ok"');
      expect(existsSync(join(tmpdir(), "8n8-claude"))).toBe(true);
    }, 120_000);
  },
);
