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

describe("extends: one file", () => {
  it("links a child class to its base", () => {
    expect(
      wires(extract("class A {}\nclass B extends A {}\n"), "extends"),
    ).toEqual(["cls:B -> cls:A"]);
  });

  it("gives the id extends:<source>-><target>", () => {
    const graph = extract("class A {}\nclass B extends A {}\n");

    expect(graph.edges.find((e) => e.kind === "extends")?.id).toBe(
      "extends:cls:B->cls:A",
    );
  });

  it("links exported and abstract classes", () => {
    const source =
      "export abstract class A {}\nexport class B extends A {}\nabstract class C extends B {}\n";

    expect(wires(extract(source), "extends")).toEqual([
      "cls:B -> cls:A",
      "cls:C -> cls:B",
    ]);
  });

  it("ignores a base from outside, generics included, and implements", () => {
    const source =
      "interface I {}\nclass A extends Error {}\nclass B extends React.Component<P> {}\nclass C implements I {}\n";

    expect(wires(extract(source), "extends")).toEqual([]);
  });

  it("links a base that is defined after the child", () => {
    expect(
      wires(extract("class B extends A {}\nclass A {}\n"), "extends"),
    ).toEqual(["cls:B -> cls:A"]);
  });

  it("keeps the wire when the class also implements an interface", () => {
    const source = "class A {}\nclass B extends A implements I {}\n";

    expect(wires(extract(source), "extends")).toEqual(["cls:B -> cls:A"]);
  });

  it("ignores a class that extends itself, a function base and a nested class", () => {
    const source =
      "class A extends A {}\nfunction F() {}\nclass B extends F {}\nclass C { m() { class D extends C {} } }\n";

    expect(wires(extract(source), "extends")).toEqual([]);
  });
});

describe("extends: project", () => {
  it("links to a class imported by name, with the file prefix on both ends", () => {
    expect(
      project({
        "base.ts": "export class A {}\n",
        "main.ts": 'import { A } from "./base";\nclass B extends A {}\n',
      }),
    ).toEqual(["file:main.ts/cls:B -> file:base.ts/cls:A"]);
  });

  it("links to a class read from a namespace import (mod.A)", () => {
    expect(
      project({
        "base.ts": "export class A {}\n",
        "main.ts": 'import * as mod from "./base";\nclass B extends mod.A {}\n',
      }),
    ).toEqual(["file:main.ts/cls:B -> file:base.ts/cls:A"]);
  });

  it("links to a default import", () => {
    expect(
      project({
        "base.ts": "export default class A {}\n",
        "main.ts": 'import Base from "./base";\nclass B extends Base {}\n',
      }),
    ).toEqual(["file:main.ts/cls:B -> file:base.ts/cls:A"]);
  });

  it("ignores an imported function and a package", () => {
    expect(
      project({
        "base.ts": "export function A() {}\n",
        "main.ts":
          'import { A } from "./base";\nimport { C } from "lib";\nclass B extends A {}\nclass D extends C {}\n',
      }),
    ).toEqual([]);
  });
});
