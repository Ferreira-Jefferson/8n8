import { describe, expect, it } from "vitest";
import { extract } from "./helpers";

const ids = (source: string) => extract(source).nodes.map((n) => n.id);

describe("structural ids", () => {
  it("names top-level nodes fn:name and cls:Name", () => {
    expect(ids("function a() {}\nclass B {}\n")).toEqual(["fn:a", "cls:B"]);
  });

  it("numbers repeated names from #2, in code order", () => {
    expect(
      ids("function a() {}\nfunction a() {}\nconst a = () => 1;\n"),
    ).toEqual(["fn:a", "fn:a#2", "fn:a#3", "fn:a#3/s0"]);
  });

  it("counts a function and a class of the same name apart", () => {
    expect(ids("function a() {}\nclass a {}\n")).toEqual(["fn:a", "cls:a"]);
  });

  it("scopes methods under the class and numbers them apart per class", () => {
    expect(
      ids(
        "class A { m() {} m() {} }\nclass B { m() {} }\nclass A { m() {} }\n",
      ),
    ).toEqual([
      "cls:A",
      "cls:A/fn:m",
      "cls:A/fn:m#2",
      "cls:B",
      "cls:B/fn:m",
      "cls:A#2",
      "cls:A#2/fn:m",
    ]);
  });

  it("names steps <parent>/s<i> and branch steps <cond>/b<j>/s<i>", () => {
    expect(
      ids(
        "function f(a) {\n  x();\n  if (a) { y(); z(); } else { w(); }\n  for (const q of a) { v(); }\n}\n",
      ),
    ).toEqual([
      "fn:f",
      "fn:f/s0",
      "fn:f/s1",
      "fn:f/s1/b0/s0",
      "fn:f/s1/b0/s1",
      "fn:f/s1/b1/s0",
      "fn:f/s2",
      "fn:f/s2/s0",
    ]);
  });

  it("is pre-order: a parent comes before its children and the module sits where the loose code starts", () => {
    expect(ids("run();\nfunction f() { g(); }\nfunction g() {}\n")).toEqual([
      "mod",
      "mod/s0",
      "fn:f",
      "fn:f/s0",
      "fn:g",
    ]);
  });
});
