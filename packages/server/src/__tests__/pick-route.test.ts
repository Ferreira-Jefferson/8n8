import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createPicker, type PickPath } from "../pick-path";
import { fakeLang } from "./fake-lang";
import { TEST_TOKEN } from "./test-token";

function setup(pick?: PickPath) {
  const app = createApp({
    plugins: [
      fakeLang(() => ({
        language: "python",
        empty: true,
        nodes: [],
        edges: [],
      })),
    ],
    explain: async () => ({ status: "no-key" }),
    titles: async () => ({ status: "ok", titles: [] }),
    readProject: async () => ({ kind: "not-found" }),
    port: 8148,
    token: TEST_TOKEN,
    pick,
  });
  return (body: unknown) =>
    app.request("/api/pick", {
      method: "POST",
      headers: {
        host: "127.0.0.1:8148",
        "content-type": "application/json",
        "x-8n8-token": TEST_TOKEN,
      },
      body: JSON.stringify(body),
    });
}

describe("POST /api/pick", () => {
  it("returns the chosen path, asking for the kind", async () => {
    const asked: string[] = [];
    const post = setup(async (kind) => {
      asked.push(kind);
      return "C:projetosloja";
    });
    const res = await post({ kind: "file" });
    expect(await res.json()).toEqual({ path: "C:projetosloja" });
    expect(asked).toEqual(["file"]);
  });

  it("gives { path: null } when the person cancels", async () => {
    const res = await setup(async () => null)({ kind: "folder" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: null });
  });

  it("refuses a bad kind with 400 and a failing chooser with 500", async () => {
    expect((await setup(async () => null)({ kind: "x" })).status).toBe(400);
    const broken = setup(async () => {
      throw new Error("sem zenity");
    });
    expect((await broken({ kind: "folder" })).status).toBe(500);
  });
});

describe("createPicker", () => {
  const run = (out: string) => async () => ({
    kind: "ok" as const,
    stdout: out,
  });

  it("runs PowerShell on Windows, osascript on macOS and zenity on Linux", async () => {
    const seen: string[] = [];
    for (const platform of ["win32", "darwin", "linux"] as const) {
      const pick = createPicker(platform, async (command) => {
        seen.push(command);
        return { kind: "ok", stdout: "/x\n" };
      });
      expect(await pick("folder", [".py"])).toBe("/x");
    }
    expect(seen).toEqual(["powershell.exe", "osascript", "zenity"]);
  });

  it("filters the file chooser by the languages' extensions", async () => {
    let script = "";
    const pick = createPicker("win32", async (_c, args) => {
      script = args.at(-1) ?? "";
      return { kind: "ok", stdout: "a.py" };
    });
    await pick("file", [".py", ".ts", "'; evil"]);
    expect(script).toContain("*.py;*.ts|");
    expect(script).not.toContain("evil");
  });

  it("names the filter by its label, with code by default, and keeps only letters, digits and spaces in it", async () => {
    let script = "";
    const pick = createPicker("win32", async (_c, args) => {
      script = args.at(-1) ?? "";
      return { kind: "ok", stdout: "claude.exe" };
    });
    await pick("file", [".py"]);
    expect(script).toContain("'Código|*.py|");
    await pick("file", [".exe"], "Claude Code");
    expect(script).toContain("'Claude Code|*.exe|");
    await pick("file", [".exe"], "x'; evil |y");
    expect(script).toContain("'x evil y|*.exe|");
  });

  it("maps a cancel or an empty answer to null", async () => {
    const cancelled = createPicker("linux", async () => ({
      kind: "cancelled",
    }));
    expect(await cancelled("file", [])).toBeNull();
    expect(await createPicker("linux", run("  \n"))("file", [])).toBeNull();
  });
});
