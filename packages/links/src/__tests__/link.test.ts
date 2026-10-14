import type { FlowNode } from "@code2n8n/model";
import { describe, expect, it } from "vitest";
import { linkProject } from "../link";
import { fileNode, innerNode, nodeId, offer, request } from "./helpers";

const nodes = [
  fileNode("a.py"),
  innerNode("a.py", "c"),
  innerNode("a.py", "d"),
  innerNode("a.py", "e"),
  innerNode("a.py", "g"),
  fileNode("b.ts"),
  innerNode("b.ts", "h"),
  innerNode("b.ts", "f"),
  fileNode("c.ts"),
  innerNode("c.ts", "file"),
];

describe("linkProject", () => {
  it("returns nothing for an empty input", () => {
    expect(linkProject({ nodes: [], offers: [], requests: [] })).toEqual({
      edges: [],
      unlinked: [],
      ambiguous: [],
    });
  });

  it("ignores offers of a channel that has no request", () => {
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /x", "b.ts", "h")],
      requests: [],
    });
    expect(out.edges).toEqual([]);
  });

  it("does not mix channels: a name request ignores http offers", () => {
    const req = request("name", "GET /x", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /x", "b.ts", "h")],
      requests: [req],
    });
    expect(out.unlinked).toEqual([req]);
  });

  it("does not duplicate a wire from two requests of the same node and target", () => {
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /x", "b.ts", "h")],
      requests: [
        request("http", "GET /x", "a.py", "c", 2),
        request("http", "GET /x/", "a.py", "c", 7),
      ],
    });
    expect(out.edges).toHaveLength(1);
  });

  it("creates a wire per call node", () => {
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /x", "b.ts", "h")],
      requests: [
        request("http", "GET /x", "a.py", "c"),
        request("http", "GET /x", "a.py", "d"),
      ],
    });
    expect(out.edges.map((e) => e.source)).toEqual([
      nodeId("a.py", "c"),
      nodeId("a.py", "d"),
    ]);
  });

  describe("order of trust", () => {
    it("skips the next channels after a wire from http", () => {
      const out = linkProject({
        nodes,
        offers: [
          offer("http", "GET /x", "b.ts", "h"),
          offer("process", "c.ts", "c.ts", "file"),
          offer("name", "calcular", "b.ts", "f"),
        ],
        requests: [
          request("name", "calcular", "a.py", "c"),
          request("process", "node c.ts", "a.py", "c"),
          request("http", "GET /x", "a.py", "c"),
        ],
      });
      expect(out.edges.map((e) => e.label)).toEqual(["HTTP GET /x"]);
      expect(out.unlinked).toEqual([]);
      expect(out.ambiguous).toEqual([]);
    });

    it("skips name after a wire from process", () => {
      const out = linkProject({
        nodes,
        offers: [
          offer("process", "c.ts", "c.ts", "file"),
          offer("name", "calcular", "b.ts", "f"),
        ],
        requests: [
          request("name", "calcular", "a.py", "c"),
          request("process", "node c.ts", "a.py", "c"),
        ],
      });
      expect(out.edges.map((e) => e.label)).toEqual(["processo"]);
    });

    it("falls to the next channel when the trusted one did not link", () => {
      const out = linkProject({
        nodes,
        offers: [offer("name", "calcular", "b.ts", "f")],
        requests: [
          request("http", "GET /nada", "a.py", "c"),
          request("name", "calcular", "a.py", "c"),
        ],
      });
      expect(out.edges.map((e) => e.label)).toEqual(["nome"]);
      expect(out.unlinked).toHaveLength(1);
    });

    it("lets two requests of one node link in the same channel", () => {
      const out = linkProject({
        nodes,
        offers: [
          offer("http", "GET /x", "b.ts", "h"),
          offer("http", "GET /y", "b.ts", "f"),
        ],
        requests: [
          request("http", "GET /x", "a.py", "c"),
          request("http", "GET /y", "a.py", "c"),
        ],
      });
      expect(out.edges).toHaveLength(2);
    });
  });

  describe("files and languages from the nodes", () => {
    it("finds the file through several parents", () => {
      const deep: FlowNode = {
        ...innerNode("a.py", "deep"),
        parentId: nodeId("a.py", "c"),
      };
      const out = linkProject({
        nodes: [...nodes, deep],
        offers: [offer("name", "calcular", "a.py", "c")],
        requests: [request("name", "calcular", "a.py", "deep")],
      });
      expect(out.edges).toEqual([]);
      expect(out.unlinked).toHaveLength(1);
    });

    it("does not loop on a parent cycle and treats the node as having no file", () => {
      const x: FlowNode = { ...innerNode("a.py", "x"), parentId: "loop:y" };
      const y: FlowNode = {
        ...innerNode("a.py", "y"),
        id: "loop:y",
        parentId: x.id,
      };
      const out = linkProject({
        nodes: [x, y, ...nodes],
        offers: [offer("name", "calcular", "b.ts", "f")],
        requests: [{ channel: "name", key: "calcular", nodeId: x.id, line: 1 }],
      });
      expect(out.edges).toHaveLength(1);
    });

    it("links nodes with no known file (no same-side check)", () => {
      const out = linkProject({
        nodes: [],
        offers: [{ channel: "name", key: "f", nodeId: "fn:f", line: 1 }],
        requests: [{ channel: "name", key: "f", nodeId: "fn:g", line: 1 }],
      });
      expect(out.edges).toHaveLength(1);
    });

    it("tells languages apart by extension, with or without one", () => {
      const out = linkProject({
        nodes: [
          fileNode("Makefile"),
          innerNode("Makefile", "c"),
          fileNode("run"),
          innerNode("run", "f"),
          fileNode("sub.d/x.PY"),
          innerNode("sub.d/x.PY", "g"),
          fileNode("y.py"),
          innerNode("y.py", "h"),
        ],
        offers: [
          offer("name", "f", "run", "f"),
          offer("name", "g", "sub.d/x.PY", "g"),
        ],
        requests: [
          request("name", "f", "Makefile", "c"),
          request("name", "g", "y.py", "h"),
        ],
      });
      // `Makefile` and `run` have no extension, so they share the language ""
      expect(out.unlinked.map((r) => r.key)).toEqual(["f", "g"]);
    });

    it("treats a dotfile as having no extension", () => {
      const out = linkProject({
        nodes: [
          fileNode(".env"),
          innerNode(".env", "a"),
          fileNode(".bashrc"),
          innerNode(".bashrc", "b"),
        ],
        offers: [offer("name", "f", ".bashrc", "b")],
        requests: [request("name", "f", ".env", "a")],
      });
      expect(out.edges).toEqual([]);
    });

    it("uses an empty path for a file node with no `path`", () => {
      const { path: _path, ...bare } = fileNode("z.py");
      const out = linkProject({
        nodes: [
          bare,
          innerNode("z.py", "a"),
          fileNode("b.ts"),
          innerNode("b.ts", "f"),
        ],
        offers: [offer("name", "f", "b.ts", "f")],
        requests: [request("name", "f", "z.py", "a")],
      });
      expect(out.edges).toHaveLength(1);
    });
  });

  describe("determinism", () => {
    const offers = [
      offer("http", "GET /x", "b.ts", "h"),
      offer("process", "c.ts", "c.ts", "file"),
      offer("name", "calcular", "b.ts", "f"),
      offer("name", "dup", "b.ts", "h"),
      offer("name", "dup", "b.ts", "f"),
    ];
    const requests = [
      request("http", "GET /x", "a.py", "c"),
      request("process", "node c.ts", "a.py", "d"),
      request("name", "calcular", "a.py", "e", 5),
      request("name", "dup", "a.py", "g", 2),
      request("name", "dup", "a.py", "e", 2),
      request("name", "nada", "a.py", "e", 9),
      request("name", "nada", "a.py", "e", 4),
      request("name", "nada", "a.py", "g", 4),
    ];

    it("gives the same output for a shuffled input", () => {
      const base = linkProject({ nodes, offers, requests });
      const shuffled = linkProject({
        nodes: [...nodes].reverse(),
        offers: [...offers].reverse(),
        requests: [
          requests[3],
          requests[7],
          requests[0],
          requests[5],
          requests[2],
          requests[6],
          requests[1],
          requests[4],
        ] as typeof requests,
      });
      expect(shuffled).toEqual(base);
      expect(JSON.stringify(shuffled)).toBe(JSON.stringify(base));
    });

    it("sorts the edges by id and the rest in a fixed order", () => {
      const out = linkProject({ nodes, offers, requests });
      const ids = out.edges.map((e) => e.id);
      expect(ids).toEqual([...ids].sort());
      expect(out.unlinked.map((r) => `${r.nodeId}:${r.line}`)).toEqual([
        `${nodeId("a.py", "e")}:4`,
        `${nodeId("a.py", "e")}:9`,
        `${nodeId("a.py", "g")}:4`,
      ]);
      expect(out.ambiguous.map((a) => a.request.nodeId)).toEqual([
        nodeId("a.py", "e"),
        nodeId("a.py", "g"),
      ]);
    });

    it("does not change the input arrays", () => {
      const before = JSON.stringify({ offers, requests });
      linkProject({ nodes, offers, requests });
      expect(JSON.stringify({ offers, requests })).toBe(before);
    });
  });
});
