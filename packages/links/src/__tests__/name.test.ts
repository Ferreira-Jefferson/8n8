import { describe, expect, it } from "vitest";
import { linkProject } from "../link";
import { nameLinker } from "../name";
import {
  contextOf,
  fileNode,
  innerNode,
  nodeId,
  offer,
  request,
} from "./helpers";

describe("name linker: matching", () => {
  const ctx = contextOf({});
  const req = request("name", "calcular_frete", "a.py", "c");

  it("matches the same name", () => {
    expect(
      nameLinker.matches(
        req,
        offer("name", "calcular_frete", "b.ts", "f"),
        ctx,
      ),
    ).toBe(true);
  });

  it("does not match another name or another case", () => {
    expect(
      nameLinker.matches(req, offer("name", "calcular", "b.ts", "f"), ctx),
    ).toBe(false);
    expect(
      nameLinker.matches(
        req,
        offer("name", "Calcular_Frete", "b.ts", "f"),
        ctx,
      ),
    ).toBe(false);
  });

  it("labels the wire `nome`", () => {
    expect(nameLinker.label(req, offer("name", "x", "b.ts", "f"))).toBe("nome");
  });
});

describe("name channel through linkProject", () => {
  const nodes = [
    fileNode("a.py"),
    innerNode("a.py", "c"),
    fileNode("b.ts"),
    innerNode("b.ts", "f"),
    fileNode("c.ts"),
    innerNode("c.ts", "f"),
    fileNode("d.py"),
    innerNode("d.py", "f"),
  ];

  it("links a name to a function of another language", () => {
    const out = linkProject({
      nodes,
      offers: [offer("name", "calcular", "b.ts", "f")],
      requests: [request("name", "calcular", "a.py", "c")],
    });
    expect(out.edges).toEqual([
      {
        id: `link:name:${nodeId("a.py", "c")}->${nodeId("b.ts", "f")}`,
        kind: "calls",
        source: nodeId("a.py", "c"),
        target: nodeId("b.ts", "f"),
        label: "nome",
      },
    ]);
  });

  it("does not link inside the same language", () => {
    const req = request("name", "calcular", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [offer("name", "calcular", "d.py", "f")],
      requests: [req],
    });
    expect(out.edges).toEqual([]);
    expect(out.unlinked).toEqual([req]);
  });

  it("does not link a node to itself", () => {
    const req = request("name", "calcular", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [offer("name", "calcular", "a.py", "c")],
      requests: [req],
    });
    expect(out.edges).toEqual([]);
    expect(out.unlinked).toEqual([req]);
  });

  it("does not count a same-language offer as a second candidate", () => {
    const out = linkProject({
      nodes,
      offers: [
        offer("name", "calcular", "d.py", "f"),
        offer("name", "calcular", "b.ts", "f"),
      ],
      requests: [request("name", "calcular", "a.py", "c")],
    });
    expect(out.edges).toHaveLength(1);
    expect(out.ambiguous).toEqual([]);
  });

  it("links only when exactly one offer matches", () => {
    const req = request("name", "calcular", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [
        offer("name", "calcular", "c.ts", "f"),
        offer("name", "calcular", "b.ts", "f"),
      ],
      requests: [req],
    });
    expect(out.edges).toEqual([]);
    expect(out.unlinked).toEqual([]);
    expect(out.ambiguous).toEqual([
      {
        request: req,
        candidates: [
          offer("name", "calcular", "b.ts", "f"),
          offer("name", "calcular", "c.ts", "f"),
        ],
      },
    ]);
  });

  it("counts two offers of the same node once", () => {
    const out = linkProject({
      nodes,
      offers: [
        offer("name", "calcular", "b.ts", "f", 3),
        offer("name", "calcular", "b.ts", "f", 9),
      ],
      requests: [request("name", "calcular", "a.py", "c")],
    });
    expect(out.edges).toHaveLength(1);
    expect(out.ambiguous).toEqual([]);
  });
});
