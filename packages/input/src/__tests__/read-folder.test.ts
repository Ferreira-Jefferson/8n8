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
import { folderName, IGNORED_DIRS, readSourceFolder } from "../read-folder";

/** What the Python plugin asks for. */
const PY = {
  extensions: [".py"],
  ignoredDirs: [".venv", "venv", "__pycache__", "site-packages"],
};

let dir: string;
const made: string[] = [];

/** A new test folder; nothing has read it yet. */
async function makeTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "input-folder-"));
  made.push(root);
  async function put(rel: string, data: string | Buffer = "x = 1\n") {
    const abs = join(root, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, data);
  }
  await put(".venv/lib/x.py");
  await put("pkg/node_modules/y.py");
  await put("a/dist/z.py");
  await put("__pycache__/c.py");
  await put("build/b.py");
  await put(".git/hooks/h.py");
  await put("pkg/venv/v.py");
  await put("lib/site-packages/s.py");
  await put("pedidos/itens.py");
  await put("B.py");
  await put("_x.py");
  await put("a.py");
  await put("notas.txt", "oi");
  await put("stub.pyi", "def f() -> int: ...\n");
  await put("a.pyc", Buffer.from([0x61, 0xe9, 0xff]));
  await put("grande.py", Buffer.alloc(1_048_577, 0x61));
  await put("latin.py", Buffer.from([0x61, 0x3d, 0xe9]));
  const outside = await mkdtemp(join(tmpdir(), "input-outside-"));
  made.push(outside);
  await writeFile(join(outside, "fora.py"), "x = 1\n");
  await symlink(outside, join(root, "atalho"), "junction");
  return root;
}

beforeAll(async () => {
  dir = await makeTree();
});

afterAll(async () => {
  for (const d of made) await rm(d, { recursive: true, force: true });
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
    const r = await readSourceFolder(dir, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    const all = [
      ...r.files.map((f) => f.path),
      ...r.ignored.map((i) => i.path),
    ];
    // The 8 folders named in the spec (PROJ-01).
    for (const bad of [
      ".git",
      ".venv",
      "venv",
      "node_modules",
      "__pycache__",
      "site-packages",
      "build",
      "dist",
    ]) {
      expect(all.some((p) => p.includes(bad))).toBe(false);
    }
    expect(r.files.map((f) => f.path)).toContain("pedidos/itens.py");
  });

  it("orders by code: B.py, _x.py, a.py", async () => {
    const r = await readSourceFolder(dir, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.files.map((f) => f.path)).toEqual([
      "B.py",
      "_x.py",
      "a.py",
      "pedidos/itens.py",
    ]);
  });

  it("leaves files without the extension out of files and ignored", async () => {
    const r = await readSourceFolder(dir, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    for (const name of ["notas.txt", "stub.pyi", "a.pyc"]) {
      expect(r.files.some((f) => f.path === name)).toBe(false);
      expect(r.ignored.some((i) => i.path === name)).toBe(false);
    }
  });

  it("returns not-found for a missing path and for a file path (PROJ-05)", async () => {
    expect(await readSourceFolder(join(dir, "nao-existe"), PY)).toEqual({
      kind: "not-found",
    });
    expect(await readSourceFolder(join(dir, "a.py"), PY)).toEqual({
      kind: "not-found",
    });
  });

  it("lists too-large and not-utf8 files in ignored, sorted by path (PROJ-06)", async () => {
    const r = await readSourceFolder(dir, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.ignored).toEqual([
      { path: "grande.py", reason: "too-large" },
      { path: "latin.py", reason: "not-utf8" },
    ]);
  });

  it("skips a directory junction", async () => {
    const r = await readSourceFolder(dir, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.files.some((f) => f.path.includes("fora.py"))).toBe(false);
    expect(r.ignored.some((i) => i.path.includes("fora.py"))).toBe(false);
  });

  it("reports the folder name and real root", async () => {
    const r = await readSourceFolder(dir, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.name).toBe(folderName(r.root));
    expect(r.name).toMatch(/^input-folder-/);
  });

  it("leaves the tree untouched (PROJ-07)", async () => {
    // A fresh folder: the "before" snapshot precedes its first read, so even
    // a write that gives the same result every time is caught.
    const fresh = await makeTree();
    const before = await snapshot(fresh);
    await readSourceFolder(fresh, PY);
    expect(await snapshot(fresh)).toEqual(before);
  });
});

describe("readSourceFolder: several languages", () => {
  const TS = { extensions: [".ts", ".tsx"], ignoredDirs: ["coverage"] };

  /** A mixed tree: Python and TypeScript sources, upper-case extensions, folders of both. */
  async function makeMixed(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "input-mixed-"));
    made.push(root);
    for (const rel of [
      "a.py",
      "UPPER.PY",
      "web/app.ts",
      "web/Tela.TSX",
      "web/tipos.d.mts",
      "notas.txt",
      ".venv/x.py",
      "coverage/c.ts",
      "coverage/c.py",
      ".venv/lib.ts",
      "node_modules/m.ts",
      "dist/d.py",
    ]) {
      await mkdir(join(root, rel, ".."), { recursive: true });
      await writeFile(join(root, rel), "x\n");
    }
    return root;
  }

  async function paths(root: string, filter: typeof PY): Promise<string[]> {
    const r = await readSourceFolder(root, filter);
    if (r.kind !== "ok") throw new Error("expected ok");
    return r.files.map((f) => f.path);
  }

  it("reads the files of every extension in the list", async () => {
    const root = await makeMixed();
    const both = {
      extensions: [...PY.extensions, ...TS.extensions],
      ignoredDirs: [...PY.ignoredDirs, ...TS.ignoredDirs],
    };

    expect(await paths(root, both)).toEqual([
      "UPPER.PY",
      "a.py",
      "web/Tela.TSX",
      "web/app.ts",
    ]);
  });

  it("matches the extension without regard to case, in the file and in the filter", async () => {
    const root = await makeMixed();

    expect(await paths(root, { extensions: [".PY"], ignoredDirs: [] })).toEqual(
      [".venv/x.py", "UPPER.PY", "a.py", "coverage/c.py"],
    );
    // `.venv` is a Python folder: only the Python plugin asks to skip it.
    expect(await paths(root, TS)).toEqual([
      ".venv/lib.ts",
      "web/Tela.TSX",
      "web/app.ts",
    ]);
  });

  it("skips only the general folders when the filter names no more", async () => {
    const root = await makeMixed();
    const found = await paths(root, {
      extensions: [".py", ".ts"],
      ignoredDirs: [],
    });

    expect(found).toContain(".venv/x.py");
    expect(found).toContain(".venv/lib.ts");
    expect(found).toContain("coverage/c.ts");
    expect(found.some((p) => p.startsWith("node_modules/"))).toBe(false);
    expect(found.some((p) => p.startsWith("dist/"))).toBe(false);
  });

  it("skips the folders that the filter names, besides the general ones", async () => {
    const root = await makeMixed();
    const found = await paths(root, {
      extensions: [".py", ".ts"],
      ignoredDirs: [".venv", "coverage"],
    });

    expect(found).toEqual(["UPPER.PY", "a.py", "web/app.ts"]);
  });

  it("reads nothing for an empty list of extensions", async () => {
    const root = await makeMixed();

    expect(await paths(root, { extensions: [], ignoredDirs: [] })).toEqual([]);
  });
});

describe("IGNORED_DIRS", () => {
  it("holds only the general folders", () => {
    expect([...IGNORED_DIRS].sort()).toEqual(
      [".git", "build", "dist", "node_modules"].sort(),
    );
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
