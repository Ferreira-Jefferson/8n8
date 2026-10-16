// The only file of packages/ allowed to start a process (CC-09): it runs the user's
// own Claude Code, in print mode, with no shell, no tools and no project settings.
import {
  type ChildProcessWithoutNullStreams,
  spawn as nodeSpawn,
} from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { type ChatMessage, type LlmClient, LocalizedError } from "@8n8/model";
import type { LlmProvider } from "./provider";

type Env = Record<string, string | undefined>;

/** Everything the provider touches outside itself; tests pass fakes. */
export interface ClaudeCodeDeps {
  spawn: (
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: Env;
      shell: false;
      windowsHide: true;
      stdio: "pipe";
    },
  ) => ChildProcessWithoutNullStreams;
  isFile: (path: string) => boolean;
  /** The empty folder the process runs in, created when missing (CC-04). */
  workDir: () => string;
  platform: NodeJS.Platform;
  home: string;
  timeoutMs: number;
  maxOutputBytes: number;
  /** How many started processes wait for the next call, at most (CC-13). */
  maxSpares: number;
  /** A waiting process that no call takes in this time is stopped (CC-13). */
  spareIdleMs: number;
}

/** 180 s per call, 5 MB of answer (CC-07); 2 waiting processes of ~300 MB, 10 min each (CC-13). */
export const LIMITS = {
  timeoutMs: 180_000,
  maxOutputBytes: 5 * 1024 * 1024,
  maxSpares: 2,
  spareIdleMs: 10 * 60_000,
} as const;

/** The deps of the real provider; the process test reuses its spawn for a stand-in Claude Code (CC-19). */
export const REAL_DEPS: ClaudeCodeDeps = {
  spawn: (command, args, options) => nodeSpawn(command, args, options),
  isFile: (path) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  workDir: () => {
    const dir = join(tmpdir(), "8n8-claude");
    mkdirSync(dir, { recursive: true });
    return dir;
  },
  platform: process.platform,
  home: homedir(),
  ...LIMITS,
};

/** A variable of `env`, whatever its case: Windows names it Path or PATH. */
const variable = (env: Env, name: string) =>
  env[Object.keys(env).find((k) => k.toUpperCase() === name) ?? name];

/** Where the executable came from: the variable, the settings dialog or the known install places. */
export type ClaudeSource = "env" | "picked" | "auto";

export interface ClaudeLocation {
  /** Undefined when no candidate is a file. */
  path: string | undefined;
  source: ClaudeSource | undefined;
  /** APP8N8_CLAUDE_PATH is set but names no file (CC-17). */
  envInvalid: boolean;
}

/**
 * The Claude Code executable (CC-02, CC-16): APP8N8_CLAUDE_PATH when it names a file, then the
 * one picked in the settings dialog, then (only with no variable) the known install places. On Windows these are the npm
 * install under APPDATA, the native installer's ~/.local/bin, and each PATH folder: its claude.exe,
 * or, beside an npm `claude.cmd`, the package's own claude.exe (any npm prefix, nvm, volta).
 */
export function findClaude(
  env: Env,
  deps: Pick<ClaudeCodeDeps, "isFile" | "platform" | "home">,
  picked?: string,
): ClaudeLocation {
  const fixed = variable(env, "APP8N8_CLAUDE_PATH");
  if (fixed && deps.isFile(fixed)) {
    return { path: fixed, source: "env", envInvalid: false };
  }
  const envInvalid = Boolean(fixed);
  if (picked && deps.isFile(picked)) {
    return { path: picked, source: "picked", envInvalid };
  }
  // A variable says "use this one": when it is wrong, the lookup does not guess another.
  if (envInvalid) return { path: undefined, source: undefined, envInvalid };
  const pathDirs = (variable(env, "PATH") ?? "")
    .split(delimiter)
    .filter(Boolean);
  const npmPackage = (dir: string) =>
    join(
      dir,
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
  const candidates =
    deps.platform === "win32"
      ? [
          ...(variable(env, "APPDATA")
            ? [npmPackage(join(variable(env, "APPDATA") as string, "npm"))]
            : []),
          join(deps.home, ".local", "bin", "claude.exe"),
          ...pathDirs.flatMap((dir) => [
            join(dir, "claude.exe"),
            npmPackage(dir),
          ]),
        ]
      : [
          ...pathDirs.map((dir) => join(dir, "claude")),
          join(deps.home, ".local", "bin", "claude"),
          join(deps.home, ".claude", "local", "claude"),
        ];
  const path = candidates.find((candidate) => deps.isFile(candidate));
  return { path, source: path ? "auto" : undefined, envInvalid };
}

/** The executable path alone, or undefined (CC-02). */
export function locateClaude(
  env: Env,
  deps: Pick<ClaudeCodeDeps, "isFile" | "platform" | "home">,
  picked?: string,
): string | undefined {
  return findClaude(env, deps, picked).path;
}

/** The real lookup on this machine, for the settings view and the default provider (CC-15). */
export const whereIsClaude = (env: Env, picked?: string): ClaudeLocation =>
  findClaude(env, REAL_DEPS, picked);

/** A picked file counts only when it is named claude or claude.exe (CC-18). */
export const isClaudeName = (path: string): boolean =>
  /^claude(\.exe)?$/i.test(path.split(/[\\/]/).pop() ?? "");

/** The keys of the other providers never reach the process (CC-05). */
const OTHER_KEYS = new Set(["OPENROUTER_API_KEY", "APP8N8_LLM_API_KEY"]);

function childEnv(env: Env): Env {
  return Object.fromEntries(
    Object.entries(env).filter(([k]) => !OTHER_KEYS.has(k.toUpperCase())),
  );
}

/** The conversation as one text: one message as it is; more, in order and marked (CC-08). */
export function conversationText(messages: ChatMessage[]): string {
  const turns = messages.filter((m) => m.role !== "system");
  if (turns.length === 1) return turns[0]?.content ?? "";
  return turns
    .map(
      (m) =>
        `${m.role === "assistant" ? "Sua resposta anterior:" : "Pedido:"}\n${m.content}`,
    )
    .join("\n\n");
}

/**
 * Print mode with JSON lines in and out, low effort, no tools, no session, no settings
 * files, no MCP, no slash commands (CC-03). Without settings files the user's hooks and
 * plugins do not run, and the process starts in half the time; the login does not live
 * there (CC-14). Low effort cuts the hidden thinking: Haiku 5.5 goes from ~12 s to ~5 s.
 */
export function claudeArgs(model: string, system: string): string[] {
  // A model from the environment is not validated by the settings: never let it read as a flag.
  if (model.startsWith("-")) throw new LocalizedError("llm.invalidModel");
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--effort",
    "low",
    ...(system ? ["--system-prompt", system] : []),
    "--tools",
    "",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
}

/** The `result` of a successful answer line; any other answer is a short error (CC-06). */
function resultOf(answer: {
  is_error?: unknown;
  subtype?: unknown;
  result?: unknown;
}): string {
  if (answer.is_error === true) {
    const subtype =
      typeof answer.subtype === "string" &&
      /^[a-z_]{1,40}$/.test(answer.subtype)
        ? answer.subtype
        : "erro";
    throw new LocalizedError("llm.refused", { subtype });
  }
  if (typeof answer.result !== "string") {
    throw new LocalizedError("llm.unknownFormat");
  }
  return answer.result;
}

/** One started Claude Code process: it waits for one request and answers it (CC-13). */
interface Session {
  /** False once the process closed, failed or took its request. */
  readonly ready: boolean;
  ask(text: string): Promise<string>;
  stop(): void;
}

function startSession(
  deps: ClaudeCodeDeps,
  executable: string,
  env: Env,
  model: string,
  system: string,
): Session {
  const child = deps.spawn(executable, claudeArgs(model, system), {
    cwd: deps.workDir(),
    env: childEnv(env),
    shell: false,
    windowsHide: true,
    stdio: "pipe",
  });
  let ready = true;
  let pending:
    | { resolve: (text: string) => void; reject: (error: Error) => void }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let line = "";
  let size = 0;
  const finish = (error: Error | null, text = "") => {
    const asked = pending;
    pending = undefined;
    clearTimeout(timer);
    if (!asked) return;
    if (error) asked.reject(error);
    else asked.resolve(text);
  };
  const stop = (error?: Error) => {
    ready = false;
    child.kill();
    if (error) finish(error);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > deps.maxOutputBytes) {
      stop(new LocalizedError("llm.tooLong"));
      return;
    }
    line += chunk.toString("utf8");
    for (let end = line.indexOf("\n"); end >= 0; end = line.indexOf("\n")) {
      const text = line.slice(0, end);
      line = line.slice(end + 1);
      let message: Record<string, unknown> | undefined;
      try {
        message = JSON.parse(text);
      } catch {
        continue;
      }
      if (message?.type !== "result") continue;
      // One request per process: the next one would see this conversation.
      let result: string;
      try {
        result = resultOf(message);
      } catch (err) {
        stop(err as Error);
        return;
      }
      finish(null, result);
      stop();
      return;
    }
  });
  // stderr is drained and dropped: it may echo the prompt.
  child.stderr.on("data", () => {});
  child.on("error", () => {
    ready = false;
    finish(new LocalizedError("llm.notOpened"));
  });
  child.on("close", (code: number | null) => {
    ready = false;
    finish(
      code === 0
        ? new LocalizedError("llm.unknownFormat")
        : new LocalizedError("llm.failed", { code: code ?? "?" }),
    );
  });
  child.stdin.on("error", () => {});
  return {
    get ready() {
      return ready;
    },
    ask(text) {
      ready = false;
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        timer = setTimeout(
          () =>
            stop(
              new LocalizedError("llm.timeout", {
                seconds: Math.round(deps.timeoutMs / 1000),
              }),
            ),
          deps.timeoutMs,
        );
        // The code of the node goes in through stdin, never as an argument (CC-03).
        child.stdin.write(
          `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`,
          "utf8",
        );
      });
    },
    stop: () => stop(),
  };
}

/** The Claude Code of the user, as an LLM provider (AD-022). */
export function createClaudeCodeProvider(
  deps: ClaudeCodeDeps = REAL_DEPS,
): LlmProvider {
  return {
    id: "claude-code",
    // Measured on 2026-10-15: as fast as Haiku 5.5 at low effort, and the alias "sonnet" of older CLIs is 4.6, 5x slower.
    defaultModel: "claude-sonnet-5-5",
    usesKey: false,
    env: {},
    isConfigured: (config, options) =>
      locateClaude(options?.env ?? {}, deps, config.claudePath) !== undefined,
    create: (config, options) => {
      const env = options?.env ?? {};
      // Started processes, one per executable, model and system prompt, oldest first (CC-13).
      const spares = new Map<
        string,
        { session: Session; idle: ReturnType<typeof setTimeout> }
      >();
      const drop = (key: string) => {
        const spare = spares.get(key);
        if (!spare) return;
        spares.delete(key);
        clearTimeout(spare.idle);
        spare.session.stop();
      };
      const keepSpare = (key: string, start: () => Session) => {
        if (deps.maxSpares <= 0 || spares.has(key)) return;
        while (spares.size >= deps.maxSpares) {
          drop(spares.keys().next().value as string);
        }
        const idle = setTimeout(() => drop(key), deps.spareIdleMs);
        idle.unref?.();
        spares.set(key, { session: start(), idle });
      };
      return {
        async complete({ model, messages }) {
          const executable = locateClaude(env, deps, config.claudePath);
          if (!executable) throw new LocalizedError("llm.notFound");
          const system = messages
            .filter((m) => m.role === "system")
            .map((m) => m.content)
            .join("\n\n");
          // Checks the model before any process starts.
          claudeArgs(model, system);
          const start = () =>
            startSession(deps, executable, env, model, system);
          const key = JSON.stringify([executable, model, system]);
          const spare = spares.get(key);
          let session = spare?.session;
          if (spare) {
            spares.delete(key);
            clearTimeout(spare.idle);
          }
          if (!session?.ready) {
            session?.stop();
            session = start();
          }
          const answer = session.ask(conversationText(messages));
          // The next call of the same kind finds a process already started.
          keepSpare(key, start);
          return answer;
        },
      } satisfies LlmClient;
    },
  };
}

export const claudeCode = createClaudeCodeProvider();
