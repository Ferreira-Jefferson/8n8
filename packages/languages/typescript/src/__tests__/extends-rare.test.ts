import type { SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { typescriptPlugin } from "../index";
import { extract, wires } from "./helpers";

const project = (files: Record<string, string>) =>
  typescriptPlugin
    .analyze(
      Object.entries(files).map(
        ([path, source]): SourceFile => ({ path, source }),
      ),
    )
    .files.flatMap((f) => wires(f.graph, "extends"));

const one = (source: string) => wires(extract(source), "extends");

describe("extends, rare shapes: one file", () => {
  it("links a generic class to a generic base the file defines", () => {
    expect(one("class A<T> {}\nclass B<T> extends A<T> {}\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });

  it("links a decorated class", () => {
    expect(one("class A {}\n@Component()\nclass B extends A {}\n")).toEqual([
      "cls:B -> cls:A",
    ]);
  });

  it("links a chain of three, one wire per step", () => {
    expect(
      one("class A {}\nclass B extends A {}\nclass C extends B {}\n"),
    ).toEqual(["cls:B -> cls:A", "cls:C -> cls:B"]);
  });

  it("ignores a class expression, which is no top-level class", () => {
    expect(one("class A {}\nconst B = class extends A {};\n")).toEqual([]);
  });

  it("ignores a base that is a call, a mixin", () => {
    expect(one("class A {}\nclass B extends Mixin(A) {}\n")).toEqual([]);
  });

  it("does not throw on an anonymous default class or an ambient class", () => {
    expect(() =>
      one("class A {}\nexport default class extends A {}\n"),
    ).not.toThrow();
    expect(() =>
      one("declare class A {}\nclass B extends A {}\n"),
    ).not.toThrow();
  });

  it("draws both wires of two classes that extend each other, without looping", () => {
    expect(one("class A extends B {}\nclass B extends A {}\n").sort()).toEqual([
      "cls:A -> cls:B",
      "cls:B -> cls:A",
    ]);
  });

  it("handles 300 classes in one chain", () => {
    const lines = ["class C0 {}"];
    for (let i = 1; i < 300; i++)
      lines.push(`class C${i} extends C${i - 1} {}`);

    expect(one(lines.join("\n"))).toHaveLength(299);
  });
});

describe("extends, rare shapes: project", () => {
  it("links a base imported under another name", () => {
    expect(
      project({
        "base.ts": "export class A {}\n",
        "main.ts":
          'import { A as Base } from "./base";\nclass B extends Base {}\n',
      }),
    ).toEqual(["file:main.ts/cls:B -> file:base.ts/cls:A"]);
  });

  it("links a base that comes through a re-export", () => {
    expect(
      project({
        "base.ts": "export class A {}\n",
        "index.ts": 'export { A } from "./base";\n',
        "main.ts": 'import { A } from "./index";\nclass B extends A {}\n',
      }),
    ).toEqual(["file:main.ts/cls:B -> file:base.ts/cls:A"]);
  });

  it("links a base from a type-only import of a class", () => {
    expect(
      project({
        "base.ts": "export class A {}\n",
        "main.ts": 'import type { A } from "./base";\nclass B extends A {}\n',
      }),
    ).toEqual(["file:main.ts/cls:B -> file:base.ts/cls:A"]);
  });

  it("links through a circular import, once", () => {
    expect(
      project({
        "base.ts": 'import { B } from "./main";\nexport class A {}\n',
        "main.ts": 'import { A } from "./base";\nexport class B extends A {}\n',
      }),
    ).toEqual(["file:main.ts/cls:B -> file:base.ts/cls:A"]);
  });

  it("draws nothing for an empty file or a file with only a syntax error", () => {
    expect(project({ "a.ts": "", "b.ts": "class (:\n" })).toEqual([]);
  });
});
