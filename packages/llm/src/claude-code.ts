// The only file of packages/ allowed to start a process (CC-09): it runs the user's
// own Claude Code, in print mode, with no shell, no tools and no project settings.
import {
  type ChildProcessWithoutNullStreams,
  spawn as nodeSpawn,
} from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { ChatMessage, LlmClient } from "@8n8/model";
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
}

/** 180 s per call, 5 MB of answer (CC-07). */
export const LIMITS = {
  timeoutMs: 180_000,
  maxOutputBytes: 5 * 1024 * 1024,
} as const;

const REAL: ClaudeCodeDeps = {
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

/** The Claude Code executable: APP8N8_CLAUDE_PATH, then the known install places (CC-02). */
export function locateClaude(
  env: Env,
  deps: Pick<ClaudeCodeDeps, "isFile" | "platform" | "home">,
): string | undefined {
  const fixed = variable(env, "APP8N8_CLAUDE_PATH");
  if (fixed) return deps.isFile(fixed) ? fixed : undefined;
  const candidates =
    deps.platform === "win32"
      ? [
          ...(variable(env, "APPDATA")
            ? [
                join(
                  variable(env, "APPDATA") as string,
                  "npm",
                  "node_modules",
                  "@anthropic-ai",
                  "claude-code",
                  "bin",
                  "claude.exe",
                ),
              ]
            : []),
          join(deps.home, ".local", "bin", "claude.exe"),
        ]
      : [
          ...(variable(env, "PATH") ?? "")
            .split(delimiter)
            .filter(Boolean)
            .map((dir) => join(dir, "claude")),
          join(deps.home, ".local", "bin", "claude"),
          join(deps.home, ".claude", "local", "claude"),
        ];
  return candidates.find((path) => deps.isFile(path));
}

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

/** Print mode, JSON out, no tools, no session, user settings only, no MCP, no slash commands (CC-03). */
export function claudeArgs(model: string, system: string): string[] {
  // A model from the environment is not validated by the settings: never let it read as a flag.
  if (model.startsWith("-"))
    throw new Error("Modelo inválido para o Claude Code.");
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    ...(system ? ["--system-prompt", system] : []),
    "--tools",
    "",
    "--no-session-persistence",
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
}

/** The `result` of a successful JSON answer; any other answer is a short error (CC-06). */
function resultOf(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("O Claude Code respondeu um formato desconhecido.");
  }
  const answer = parsed as {
    is_error?: unknown;
    subtype?: unknown;
    result?: unknown;
  };
  if (answer?.is_error === true) {
    const subtype =
      typeof answer.subtype === "string" &&
      /^[a-z_]{1,40}$/.test(answer.subtype)
        ? answer.subtype
        : "erro";
    throw new Error(`O Claude Code recusou o pedido: ${subtype}.`);
  }
  if (typeof answer?.result !== "string") {
    throw new Error("O Claude Code respondeu um formato desconhecido.");
  }
  return answer.result;
}

function runClaude(
  deps: ClaudeCodeDeps,
  executable: string,
  env: Env,
  model: string,
  messages: ChatMessage[],
): Promise<string> {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  return new Promise((resolve, reject) => {
    const child = deps.spawn(executable, claudeArgs(model, system), {
      cwd: deps.workDir(),
      env: childEnv(env),
      shell: false,
      windowsHide: true,
      stdio: "pipe",
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error: Error | null, text = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(text);
    };
    const stop = (message: string) => {
      child.kill();
      finish(new Error(message));
    };
    const timer = setTimeout(
      () =>
        stop(
          `O Claude Code não respondeu em ${Math.round(deps.timeoutMs / 1000)} s.`,
        ),
      deps.timeoutMs,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > deps.maxOutputBytes) {
        stop("O Claude Code respondeu demais.");
        return;
      }
      chunks.push(chunk);
    });
    // stderr is drained and dropped: it may echo the prompt.
    child.stderr.on("data", () => {});
    child.on("error", () => finish(new Error("O Claude Code não abriu.")));
    child.on("close", (code: number | null) => {
      if (code !== 0) {
        finish(new Error(`O Claude Code falhou (código ${code ?? "?"}).`));
        return;
      }
      try {
        finish(null, resultOf(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        finish(err as Error);
      }
    });
    // The code of the node goes in through stdin, never as an argument (CC-03).
    child.stdin.on("error", () => {});
    child.stdin.end(conversationText(messages), "utf8");
  });
}

/** The Claude Code of the user, as an LLM provider (AD-022). */
export function createClaudeCodeProvider(
  deps: ClaudeCodeDeps = REAL,
): LlmProvider {
  return {
    id: "claude-code",
    defaultModel: "sonnet",
    usesKey: false,
    env: {},
    isConfigured: (_config, options) =>
      locateClaude(options?.env ?? {}, deps) !== undefined,
    create: (_config, options) => {
      const env = options?.env ?? {};
      return {
        async complete({ model, messages }) {
          const executable = locateClaude(env, deps);
          if (!executable) throw new Error("O Claude Code não foi encontrado.");
          return runClaude(deps, executable, env, model, messages);
        },
      } satisfies LlmClient;
    },
  };
}

export const claudeCode = createClaudeCodeProvider();
