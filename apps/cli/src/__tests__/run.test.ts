import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { type RunDeps, run } from "../run";

const root = mkdtempSync(join(tmpdir(), "8n8-cli-"));
afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows keeps the open history databases locked until the worker exits.
  }
});
let n = 0;

/** A run with every effect recorded: what was printed, served and opened, in order. */
function harness(env: Record<string, string> = {}) {
  const home = join(root, `home${n++}`);
  const project = join(home, "proj");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "a.py"), "def f():\n    pass\n");
  const pts = join(home, "pts.md");
  writeFileSync(pts, "regras");
  const events: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let app: Hono | undefined;
  let port: number | undefined;
  const deps: RunDeps = {
    env,
    cwd: home,
    home,
    paths: { web: undefined, ptsRules: pts },
    out: (line) => {
      out.push(line);
      events.push(`out:${line}`);
    },
    err: (line) => err.push(line),
    serve: async (served, p) => {
      app = served;
      port = p;
      events.push("serve");
    },
    openBrowser: (url) => events.push(`open:${url}`),
  };
  return {
    deps,
    home,
    project,
    events,
    out,
    err,
    app: () => {
      if (!app) throw new Error("not served");
      return app;
    },
    port: () => port,
  };
}

const opened = (events: string[]) =>
  events.filter((e) => e.startsWith("open:")).map((e) => e.slice(5));
const launch = (url: string) =>
  new URLSearchParams(new URL(url).hash.replace(/^#/, ""));

describe("8n8 [pasta] (DIST-01..07)", () => {
  it("serves on the default port and opens the folder's map with the token (DIST-01)", async () => {
    const h = harness();
    expect(await run([h.project], h.deps)).toBe(0);
    expect(h.port()).toBe(4317);
    const [url] = opened(h.events);
    expect(url?.startsWith("http://127.0.0.1:4317/#")).toBe(true);
    expect(launch(url ?? "").get("pasta")).toBe(h.project);
    expect(launch(url ?? "").get("t")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("with no folder opens the start screen: token only (DIST-02)", async () => {
    const h = harness();
    expect(await run([], h.deps)).toBe(0);
    const params = launch(opened(h.events)[0] ?? "");
    expect(params.get("pasta")).toBeNull();
    expect(params.get("t")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("resolves a relative folder from the terminal's folder (DIST-03)", async () => {
    const h = harness();
    await run(["proj"], h.deps);
    expect(launch(opened(h.events)[0] ?? "").get("pasta")).toBe(h.project);
  });

  it.runIf(process.platform === "win32")(
    "takes C:\\ and C:/ as the same folder (DIST-04)",
    async () => {
      const a = harness();
      const b = harness();
      await run([a.project.replaceAll("\\", "/")], a.deps);
      await run([b.project.replaceAll("/", "\\")], b.deps);
      expect(launch(opened(a.events)[0] ?? "").get("pasta")).toBe(a.project);
      expect(launch(opened(b.events)[0] ?? "").get("pasta")).toBe(b.project);
    },
  );

  it("refuses a missing folder: message, code 1, no server, no browser (DIST-05)", async () => {
    const h = harness();
    const missing = join(h.home, "nada");
    expect(await run([missing], h.deps)).toBe(1);
    expect(h.err).toEqual([`Pasta não encontrada: ${missing}`]);
    expect(h.events).toEqual([]);
  });

  it("refuses a file given as the folder (DIST-05)", async () => {
    const h = harness();
    const file = join(h.project, "a.py");
    expect(await run([file], h.deps)).toBe(1);
    expect(h.err).toEqual([`Pasta não encontrada: ${file}`]);
  });

  it("stops with the port message when the port is taken (DIST-06)", async () => {
    const h = harness({ APP8N8_PORT: "4555" });
    h.deps.serve = async () => {
      throw Object.assign(new Error("listen EADDRINUSE"), {
        code: "EADDRINUSE",
      });
    };
    expect(await run([], h.deps)).toBe(1);
    expect(h.err).toEqual([
      "A porta 4555 já está em uso. Feche o outro processo e tente de novo.",
    ]);
    expect(opened(h.events)).toEqual([]);
  });

  it("prints the address with the token before it opens the browser (DIST-07)", async () => {
    const h = harness();
    await run([], h.deps);
    const url = opened(h.events)[0] ?? "";
    expect(h.events.indexOf(`out:8n8 em ${url}`)).toBeGreaterThanOrEqual(0);
    expect(h.events.indexOf(`out:8n8 em ${url}`)).toBeLessThan(
      h.events.indexOf(`open:${url}`),
    );
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:4317\/#t=[0-9a-f]{64}$/);
  });

  it("--no-open serves and prints but opens no browser", async () => {
    const h = harness();
    expect(await run(["--no-open"], h.deps)).toBe(0);
    expect(h.events).toContain("serve");
    expect(h.out[0]).toMatch(/^8n8 em http:\/\/127\.0\.0\.1:4317\/#t=/);
    expect(opened(h.events)).toEqual([]);
  });
});

describe("8n8 --help (DIST-08)", () => {
  it("prints the usage and starts nothing", async () => {
    const h = harness();
    expect(await run(["--help"], h.deps)).toBe(0);
    const text = h.out.join("\n");
    for (const part of [
      "8n8 [pasta]",
      "--no-open",
      "APP8N8_PORT",
      "APP8N8_CACHE_DIR",
      "APP8N8_HISTORY_DIR",
      "APP8N8_LLM_PROVIDER",
      "OPENROUTER_API_KEY",
      "APP8N8_MODEL",
    ]) {
      expect(text).toContain(part);
    }
    expect(h.events.filter((e) => !e.startsWith("out:"))).toEqual([]);
  });
});

describe("data folders (DIST-09)", () => {
  const saveAMap = (app: Hono, token: string) =>
    app.request("/api/graph", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4317",
        "content-type": "application/json",
        "x-8n8-token": token,
      },
      body: JSON.stringify({ source: "def f():\n    pass\n" }),
    });
  const tokenOf = (h: ReturnType<typeof harness>) =>
    launch(opened(h.events)[0] ?? "").get("t") ?? "";

  it("keeps the history in ~/.8n8/historico.db", async () => {
    const h = harness();
    await run([], h.deps);
    await saveAMap(h.app(), tokenOf(h));
    expect(existsSync(join(h.home, ".8n8", "historico.db"))).toBe(true);
  });

  it("moves the history to APP8N8_HISTORY_DIR", async () => {
    const elsewhere = join(root, `hist${n++}`);
    const h = harness({ APP8N8_HISTORY_DIR: elsewhere });
    await run([], h.deps);
    await saveAMap(h.app(), tokenOf(h));
    expect(existsSync(join(elsewhere, "historico.db"))).toBe(true);
    expect(existsSync(join(h.home, ".8n8", "historico.db"))).toBe(false);
  });
});

describe("no LLM config (DIST-11)", () => {
  it("serves the map, and the explain answer is the no-key notice", async () => {
    const h = harness();
    await run([h.project], h.deps);
    const token = launch(opened(h.events)[0] ?? "").get("t") ?? "";
    const res = await h.app().request("/api/explain", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4317",
        "content-type": "application/json",
        "x-8n8-token": token,
      },
      body: JSON.stringify({ root: h.project, nodeId: "file:a.py/fn:f" }),
    });
    expect(await res.json()).toEqual({ status: "no-key" });
  });
});

describe("session token (DIST-18)", () => {
  it("uses APP8N8_TOKEN when it has 32 characters or more", async () => {
    const token = "e2e-session-token-not-a-secret-0000";
    const h = harness({ APP8N8_TOKEN: token });
    await run([], h.deps);
    expect(launch(opened(h.events)[0] ?? "").get("t")).toBe(token);
  });

  it("refuses a shorter APP8N8_TOKEN with code 1 and serves nothing", async () => {
    const h = harness({ APP8N8_TOKEN: "curto" });
    expect(await run([], h.deps)).toBe(1);
    expect(h.err).toEqual(["APP8N8_TOKEN precisa de 32 caracteres ou mais."]);
    expect(h.events).toEqual([]);
  });

  it("makes a new token on every run", async () => {
    const a = harness();
    const b = harness();
    await run([], a.deps);
    await run([], b.deps);
    expect(launch(opened(a.events)[0] ?? "").get("t")).not.toBe(
      launch(opened(b.events)[0] ?? "").get("t"),
    );
  });
});

describe("the API key never reaches the terminal (DIST-17, DIST-22)", () => {
  it("prints no part of the key in any path", async () => {
    const SENTINEL = "sk-sentinel-0000000000000000000000000000";
    const env = { OPENROUTER_API_KEY: SENTINEL };
    const runs: [string[], ReturnType<typeof harness>][] = [];
    for (const argv of [[], ["--help"], ["nada"], ["--no-open"]]) {
      const h = harness(env);
      await run(argv, h.deps);
      runs.push([argv, h]);
    }
    for (const [, h] of runs) {
      expect([...h.out, ...h.err].join("\n")).not.toContain(
        SENTINEL.slice(0, 6),
      );
    }
  });
});
