import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    lstat: vi.fn(real.lstat),
    readFile: vi.fn(real.readFile),
  };
});

import * as fs from "node:fs/promises";
import { readSourceFile } from "../read-file";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "input-file-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readSourceFile", () => {
  it("reads a file of exactly 1 048 576 bytes", async () => {
    const abs = join(dir, "limit.py");
    await writeFile(abs, Buffer.alloc(1_048_576, 0x61));
    const r = await readSourceFile(abs, "limit.py");
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.file.path).toBe("limit.py");
      expect(r.file.source.length).toBe(1_048_576);
    }
  });

  it("ignores a file of 1 048 577 bytes as too-large", async () => {
    const abs = join(dir, "big.py");
    await writeFile(abs, Buffer.alloc(1_048_577, 0x61));
    expect(await readSourceFile(abs, "big.py")).toEqual({
      kind: "ignored",
      ignored: { path: "big.py", reason: "too-large" },
    });
  });

  it("ignores a file with the byte 0xE9 as not-utf8", async () => {
    const abs = join(dir, "latin.py");
    await writeFile(abs, Buffer.from([0x61, 0x3d, 0xe9]));
    expect(await readSourceFile(abs, "latin.py")).toEqual({
      kind: "ignored",
      ignored: { path: "latin.py", reason: "not-utf8" },
    });
  });

  it("removes the UTF-8 BOM", async () => {
    const abs = join(dir, "bom.py");
    await writeFile(
      abs,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("x = 1\n")]),
    );
    const r = await readSourceFile(abs, "bom.py");
    expect(r).toEqual({
      kind: "ok",
      file: { path: "bom.py", source: "x = 1\n" },
    });
  });

  it("ignores a file that fails to read with EACCES as unreadable", async () => {
    const abs = join(dir, "locked.py");
    await writeFile(abs, "x = 1\n");
    vi.mocked(fs.readFile).mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "EACCES" }),
    );
    expect(await readSourceFile(abs, "locked.py")).toEqual({
      kind: "ignored",
      ignored: { path: "locked.py", reason: "unreadable" },
    });
  });

  it("ignores a link as symlink without ever reading it", async () => {
    const abs = join(dir, "link.py");
    await writeFile(abs, "x = 1\n");
    vi.mocked(fs.lstat).mockResolvedValueOnce({
      isSymbolicLink: () => true,
      size: 6,
    } as unknown as Awaited<ReturnType<typeof fs.lstat>>);
    vi.mocked(fs.readFile).mockClear();
    vi.mocked(fs.readFile).mockImplementationOnce(() => {
      throw new Error("must not read a link");
    });
    expect(await readSourceFile(abs, "link.py")).toEqual({
      kind: "ignored",
      ignored: { path: "link.py", reason: "symlink" },
    });
    expect(fs.readFile).not.toHaveBeenCalled();
    vi.mocked(fs.readFile).mockReset();
  });

  it("recognises a real symlink when the platform allows creating one", async () => {
    const target = join(dir, "target.py");
    const abs = join(dir, "real-link.py");
    await writeFile(target, "x = 1\n");
    try {
      await symlink(target, abs);
    } catch {
      return;
    }
    expect(await readSourceFile(abs, "real-link.py")).toEqual({
      kind: "ignored",
      ignored: { path: "real-link.py", reason: "symlink" },
    });
  });

  it("returns the rel path in POSIX form", async () => {
    const abs = join(dir, "p.py");
    await writeFile(abs, "x = 1\n");
    const r = await readSourceFile(abs, String.raw`pedidos\itens.py`);
    expect(r.kind === "ok" && r.file.path).toBe("pedidos/itens.py");
  });
});
