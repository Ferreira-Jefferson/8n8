import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLanguages, fetchProject, saveSettings } from "../api";
import { resetVscodeHostForTest, vscodeHost } from "../vscode-host";

/** The page as the extension builds it: the host meta and the webview global. */
function webview(): unknown[] {
  const posted: unknown[] = [];
  const meta = document.createElement("meta");
  meta.name = "8n8-host";
  meta.content = "vscode";
  document.head.append(meta);
  vi.stubGlobal(
    "acquireVsCodeApi",
    vi.fn(() => ({ postMessage: (m: unknown) => posted.push(m) })),
  );
  return posted;
}

/** The extension's answer to the message with `id`. */
function reply(id: number, status: number, body: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "api-response",
        id,
        status,
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
    }),
  );
}

beforeEach(() => resetVscodeHostForTest());
afterEach(() => {
  for (const m of document.head.querySelectorAll('meta[name="8n8-host"]')) {
    m.remove();
  }
  vi.unstubAllGlobals();
  resetVscodeHostForTest();
});

describe("vscodeHost (VSC-04)", () => {
  it("is null in a browser: no meta, no webview global", () => {
    expect(vscodeHost()).toBeNull();
  });

  it("is null with the global but without the meta", () => {
    vi.stubGlobal("acquireVsCodeApi", vi.fn());
    expect(vscodeHost()).toBeNull();
  });

  it("acquires the webview API once", () => {
    webview();
    const acquire = vi.mocked(
      (globalThis as unknown as { acquireVsCodeApi: () => unknown })
        .acquireVsCodeApi,
    );
    expect(vscodeHost()).toBe(vscodeHost());
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});

describe("the API through the extension (VSC-04, VSC-11)", () => {
  it("sends a GET as a message, without a token, and reads the reply", async () => {
    const posted = webview();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const answer = fetchLanguages();
    expect(posted).toEqual([
      {
        type: "api",
        id: expect.any(Number),
        method: "GET",
        path: "/api/languages",
      },
    ]);
    const { id } = posted[0] as { id: number };
    reply(id, 200, {
      languages: [{ id: "python", label: "Python", extensions: [".py"] }],
    });
    expect(await answer).toEqual([
      { id: "python", label: "Python", extensions: [".py"] },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(posted)).not.toContain("x-8n8-token");
  });

  it("sends the JSON body of a POST and a PUT", async () => {
    const posted = webview();
    const project = fetchProject("C:/loja");
    const settings = saveSettings({ autoSummary: true });
    const [p, s] = posted as { id: number; method: string; body: string }[];
    expect(p).toMatchObject({ method: "POST", path: "/api/project" });
    expect(JSON.parse(p?.body ?? "")).toEqual({ path: "C:/loja" });
    expect(s).toMatchObject({ method: "PUT", path: "/api/settings" });
    reply(s?.id ?? 0, 400, { error: "invalid settings" });
    reply(p?.id ?? 0, 404, { error: "not-found" });
    expect(await settings).toBeNull();
    expect(await project).toEqual({ error: "not-found", path: "C:/loja" });
  });

  it("ignores replies to other ids and messages of other kinds", async () => {
    const posted = webview();
    const answer = fetchLanguages();
    const { id } = posted[0] as { id: number };
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "other", id } }),
    );
    reply(id + 1000, 200, { languages: [] });
    reply(id, 200, { languages: [] });
    expect(await answer).toEqual([]);
  });
});
