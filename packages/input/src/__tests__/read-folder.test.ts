import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { folderName, readSourceFolder } from "../read-folder";

let dir: string;

async function put(rel: string, data: string | Buffer = "x = 1\n") {
  const abs = join(dir, rel);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, data);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "input-folder-"));
  await put(".venv/lib/x.py");
  await put("pkg/node_modules/y.py");
  await put("a/dist/z.py");
  await put("__pycache__/c.py");
  await put("build/b.py");
  await put("pedidos/itens.py");
  await put("B.py");
  await put("_x.py");
  await put("a.py");
  await put("notas.txt", "oi");
  await put("grande.py", Buffer.alloc(1_048_577, 0x61));
  await put("latin.py", Buffer.from([0x61, 0x3d, 0xe9]));
  const outside = await mkdtemp(join(tmpdir(), "input-outside-"));
  await writeFile(join(outside, "fora.py"), "x = 1\n");
  await symlink(outside, join(dir, "atalho"), "junction");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function snapshot(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isSymbolicLink()) out.push(`link|${p}`);
      else if (e.isDirectory()) await walk(p);
      else {
        const s = await stat(p);
        const h = createHash("sha256")
          .update(await readFile(p))
          .digest("hex");
        out.push(`${p}|${s.size}|${s.mtimeMs}|${h}`);
      }
    }
  }
  await walk(root);
  return out.sort();
}

describe("readSourceFolder", () => {
  it("skips ignored directories at any depth, silently (PROJ-01)", async () => {
    const r = await readSourceFolder(dir, ".py");
    if (r.kind !== "ok") throw new Error("expected ok");
    const all = [
      ...r.files.map((f) => f.path),
      ...r.ignored.map((i) => i.path),
    ];
    for (const bad of [
      ".venv",
      "node_modules",
      "dist",
      "__pycache__",
      "build",
    ]) {
      expect(all.some((p) => p.includes(bad))).toBe(false);
    }
    expect(r.files.map((f) => f.path)).toContain("pedidos/itens.py");
  });

  it("orders by code: B.py, _x.py, a.py", async () => {
    const r = await readSourceFolder(dir, ".py");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.files.map((f) => f.path)).toEqual([
      "B.py",
      "_x.py",
      "a.py",
      "pedidos/itens.py",
    ]);
  });

  it("leaves files without the extension out of files and ignored", async () => {
    const r = await readSourceFolder(dir, ".py");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.files.some((f) => f.path === "notas.txt")).toBe(false);
    expect(r.ignored.some((i) => i.path === "notas.txt")).toBe(false);
  });

  it("returns not-found for a missing path and for a file path (PROJ-05)", async () => {
    expect(await readSourceFolder(join(dir, "nao-existe"), ".py")).toEqual({
      kind: "not-found",
    });
    expect(await readSourceFolder(join(dir, "a.py"), ".py")).toEqual({
      kind: "not-found",
    });
  });

  it("lists too-large and not-utf8 files in ignored, sorted by path (PROJ-06)", async () => {
    const r = await readSourceFolder(dir, ".py");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.ignored).toEqual([
      { path: "grande.py", reason: "too-large" },
      { path: "latin.py", reason: "not-utf8" },
    ]);
  });

  it("skips a directory junction", async () => {
    const r = await readSourceFolder(dir, ".py");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.files.some((f) => f.path.includes("fora.py"))).toBe(false);
    expect(r.ignored.some((i) => i.path.includes("fora.py"))).toBe(false);
  });

  it("reports the folder name and real root", async () => {
    const r = await readSourceFolder(dir, ".py");
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.name).toBe(folderName(r.root));
    expect(r.name).toMatch(/^input-folder-/);
  });

  it("leaves the tree untouched (PROJ-07)", async () => {
    const before = await snapshot(dir);
    await readSourceFolder(dir, ".py");
    expect(await snapshot(dir)).toEqual(before);
  });
});

describe("folderName", () => {
  it("returns the whole path for a disk root", () => {
    expect(folderName("C:\\")).toBe("C:\\");
    expect(folderName("/")).toBe("/");
  });

  it("returns the basename otherwise", () => {
    expect(folderName(join(tmpdir(), "loja"))).toBe("loja");
  });
});
