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
import {
  folderName,
  IGNORED_DIRS,
  type ReadFilter,
  readSourceFolder,
} from "../read-folder";

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

  it("returns not-found for a missing path (PROJ-05)", async () => {
    expect(await readSourceFolder(join(dir, "nao-existe"), PY)).toEqual({
      kind: "not-found",
    });
  });

  it("lists too-large and not-utf8 files in ignored, sorted by path (PROJ-06)", async () => {
    const r = await readSourceFolder(dir, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.ignored).toEqual([
      { path: "grande.py", reason: "too-large", addable: true },
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

  async function paths(root: string, filter: ReadFilter): Promise<string[]> {
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

  it("reads the files of an exact name too, but no other file that ends like it", async () => {
    const root = await makeMixed();
    await writeFile(join(root, "web", "package.json"), "{}\n");
    await writeFile(join(root, "web", "my-package.json"), "{}\n");

    expect(await paths(root, { ...TS, names: ["package.json"] })).toEqual([
      ".venv/lib.ts",
      "web/Tela.TSX",
      "web/app.ts",
      "web/package.json",
    ]);
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

describe("readSourceFolder and .gitignore (CLEAN-01, CLEAN-02)", () => {
  async function tree(files: Record<string, string | Buffer>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "input-gitignore-"));
    made.push(root);
    for (const [rel, data] of Object.entries(files)) {
      await mkdir(join(root, rel, ".."), { recursive: true });
      await writeFile(join(root, rel), data);
    }
    return root;
  }
  const paths = async (root: string, include: string[] = []) => {
    const read = await readSourceFolder(root, { ...PY, include });
    if (read.kind !== "ok") throw new Error("not-found");
    return {
      files: read.files.map((f) => f.path),
      ignored: read.ignored.map((f) => f.path),
    };
  };

  it("skips what the root .gitignore ignores, folders and files, and lists none of it", async () => {
    const root = await tree({
      ".gitignore": "gerado/\n*.log.py\n/so_na_raiz.py\n",
      "gerado/a.py": "x = 1\n",
      "gerado/grande.py": Buffer.alloc(1_048_577, 0x61),
      "app/run.log.py": "x = 1\n",
      "so_na_raiz.py": "x = 1\n",
      "app/so_na_raiz.py": "x = 1\n",
      "app/main.py": "x = 1\n",
    });
    expect(await paths(root)).toEqual({
      files: ["app/main.py", "app/so_na_raiz.py"],
      ignored: [],
    });
  });

  it("lists what the .gitignore ignores when ignoreDependencies is off", async () => {
    const root = await tree({
      ".gitignore": "gerado/\n*.log.py\n",
      "gerado/a.py": "x = 1\n",
      "app/run.log.py": "x = 1\n",
      "app/main.py": "x = 1\n",
    });
    const read = await readSourceFolder(root, {
      ...PY,
      ignoreDependencies: false,
    });
    if (read.kind !== "ok") throw new Error("not-found");
    expect(read.files.map((f) => f.path)).toEqual([
      "app/main.py",
      "app/run.log.py",
      "gerado/a.py",
    ]);
  });

  it("applies a sub-folder's .gitignore below it only, and lets a deeper ! win", async () => {
    const root = await tree({
      ".gitignore": "*.gen.py\n",
      "lib/.gitignore": "tmp/\n!keep.gen.py\n",
      "lib/tmp/t.py": "x = 1\n",
      "lib/keep.gen.py": "x = 1\n",
      "lib/drop.gen.py": "x = 1\n",
      "tmp/fora.py": "x = 1\n",
      "outro.gen.py": "x = 1\n",
    });
    expect((await paths(root)).files).toEqual([
      "lib/keep.gen.py",
      "tmp/fora.py",
    ]);
  });

  it("anchors a sub-folder's /pattern to that sub-folder, not to the root", async () => {
    const root = await tree({
      "lib/.gitignore": "/local.py\n",
      "lib/local.py": "x = 1\n",
      "lib/sub/local.py": "x = 1\n",
    });
    expect((await paths(root)).files).toEqual(["lib/sub/local.py"]);
  });

  it("never walks an ignored folder, so its own .gitignore cannot bring a file back", async () => {
    const root = await tree({
      ".gitignore": "gerado/\n",
      "gerado/.gitignore": "!a.py\n",
      "gerado/a.py": "x = 1\n",
      "b.py": "x = 1\n",
    });
    expect((await paths(root)).files).toEqual(["b.py"]);
  });

  it("supports ** and leaves a folder without .gitignore as before", async () => {
    const withRules = await tree({
      ".gitignore": "**/fixtures/**\n",
      "a/b/fixtures/f.py": "x = 1\n",
      "a/b/c.py": "x = 1\n",
    });
    expect((await paths(withRules)).files).toEqual(["a/b/c.py"]);
    const plain = await tree({ "fixtures/f.py": "x = 1\n" });
    expect((await paths(plain)).files).toEqual(["fixtures/f.py"]);
  });

  it("puts an added file over 1 MB on the map and out of the list (CLEAN-06)", async () => {
    const root = await tree({
      "grande.py": Buffer.alloc(1_048_577, 0x61),
      "a.py": "x = 1\n",
    });
    expect(await paths(root)).toEqual({
      files: ["a.py"],
      ignored: ["grande.py"],
    });
    expect(await paths(root, ["grande.py"])).toEqual({
      files: ["a.py", "grande.py"],
      ignored: [],
    });
  });
});

describe("readSourceFolder with a file path", () => {
  it("reads that one file as the whole map, with the file as root", async () => {
    const root = await makeTree();
    const file = join(root, "pkg", "a.py");
    await mkdir(join(root, "pkg"), { recursive: true });
    await writeFile(file, "x = 1\n");
    const read = await readSourceFolder(file, PY);
    expect(read.kind).toBe("ok");
    if (read.kind !== "ok") return;
    expect(read.name).toBe("a.py");
    expect(read.files).toEqual([{ path: "a.py", source: "x = 1\n" }]);
    expect(read.root.endsWith("a.py")).toBe(true);
  });

  it("does not know a file of another language", async () => {
    const root = await makeTree();
    const file = join(root, "notas.txt");
    await writeFile(file, "oi");
    expect(await readSourceFolder(file, PY)).toEqual({ kind: "not-found" });
  });
});

describe("readSourceFolder and dependency folders", () => {
  it("refuses a folder named node_modules, or inside one, as a dependency", async () => {
    const inside = join(dir, "pkg", "node_modules");
    expect(await readSourceFolder(inside, PY)).toEqual({
      kind: "not-found",
      dependency: true,
    });
    const deeper = join(dir, "lib", "site-packages");
    expect(await readSourceFolder(deeper, PY)).toEqual({
      kind: "not-found",
      dependency: true,
    });
    expect(
      await readSourceFolder(join(dir, "pkg", "node_modules", "y.py"), PY),
    ).toEqual({ kind: "not-found", dependency: true });
  });

  it("still opens a folder that sits under build or dist", async () => {
    const root = await mkdtemp(join(tmpdir(), "input-dist-"));
    made.push(root);
    const project = join(root, "dist", "app");
    await mkdir(project, { recursive: true });
    await writeFile(join(project, "m.py"), "x = 1\n");
    const r = await readSourceFolder(project, PY);
    expect(r.kind).toBe("ok");
  });

  it("opens a dependency folder and walks into one when the setting is off, but never .git", async () => {
    const off = { ...PY, ignoreDependencies: false };
    const direct = await readSourceFolder(
      join(dir, "pkg", "node_modules"),
      off,
    );
    expect(direct.kind).toBe("ok");
    const r = await readSourceFolder(dir, off);
    if (r.kind !== "ok") throw new Error("expected ok");
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain("pkg/node_modules/y.py");
    expect(paths).toContain(".venv/lib/x.py");
    expect(paths.some((p) => p.startsWith(".git/"))).toBe(false);
  });
});

describe("readSourceFolder reads many files at once and keeps the order", () => {
  it("gives the files in the order of the sorted names, folders in place, for a folder of 300 files", async () => {
    const root = await mkdtemp(join(tmpdir(), "input-many-"));
    made.push(root);
    const names: string[] = [];
    for (let d = 0; d < 6; d++) {
      for (let s = 0; s < 5; s++) {
        const rel = `d${d}/s${s}`;
        await mkdir(join(root, rel), { recursive: true });
        for (let f = 0; f < 10; f++) {
          names.push(`${rel}/m${f}.py`);
          await writeFile(join(root, `${rel}/m${f}.py`), `x = ${f}\n`);
        }
        await writeFile(join(root, `${rel}.py`), "y = 1\n");
        names.push(`${rel}.py`);
      }
    }
    await writeFile(join(root, "z.py"), "z = 1\n");
    names.push("z.py");
    // The walk goes by sorted names, a folder where its name falls among the files.
    const expected: string[] = [];
    const walk = (rel: string) => {
      const here = new Set<string>();
      for (const n of names) {
        if (!n.startsWith(rel === "" ? "" : `${rel}/`)) continue;
        const rest = n.slice(rel === "" ? 0 : rel.length + 1);
        here.add(rest.split("/")[0] as string);
      }
      for (const entry of [...here].sort()) {
        const path = rel === "" ? entry : `${rel}/${entry}`;
        if (names.includes(path)) expected.push(path);
        else walk(path);
      }
    };
    walk("");
    const r = await readSourceFolder(root, PY);
    if (r.kind !== "ok") throw new Error("expected ok");
    expect(r.files.map((f) => f.path)).toEqual(expected);
    expect(r.files).toHaveLength(names.length);
    expect(r.files.find((f) => f.path === "d3/s2/m7.py")?.source).toBe(
      "x = 7\n",
    );
  });
});
