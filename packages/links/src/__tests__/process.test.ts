import { describe, expect, it } from "vitest";
import { linkProject } from "../link";
import { processLinker } from "../process";
import {
  contextOf,
  fileNode,
  innerNode,
  nodeId,
  offer,
  request,
} from "./helpers";

/** The request is in `from`; the offer is the file `target`. */
function matches(command: string, target: string, from = "a.py"): boolean {
  const req = request("process", command, from, "c");
  const off = offer("process", target, target, "file");
  return processLinker.matches(
    req,
    off,
    contextOf({ [req.nodeId]: from, [off.nodeId]: target }),
  );
}

describe("process linker: matching", () => {
  it("matches a command that cites the file", () => {
    expect(matches("node b.ts", "b.ts")).toBe(true);
    expect(matches("python c.py", "c.py", "a.ts")).toBe(true);
  });

  it("matches a bare path", () => {
    expect(matches("b.ts", "b.ts")).toBe(true);
  });

  it("matches a path with ./", () => {
    expect(matches("./scripts/b.ts", "scripts/b.ts")).toBe(true);
  });

  it("matches a path with backslashes", () => {
    expect(matches("node scripts\\b.ts", "scripts/b.ts")).toBe(true);
    expect(matches("node .\\scripts\\b.ts", "scripts/b.ts")).toBe(true);
  });

  it("matches a quoted word", () => {
    expect(matches(`node "b.ts" --flag`, "b.ts")).toBe(true);
    expect(matches(`['node', 'b.ts']`, "b.ts")).toBe(true);
  });

  it("matches a path relative to the requesting file", () => {
    expect(matches("node b.ts", "scripts/b.ts", "scripts/a.py")).toBe(true);
    expect(matches("../tools/b.ts", "tools/b.ts", "scripts/a.py")).toBe(true);
  });

  it("still matches from the root when the requesting file is in a folder", () => {
    expect(matches("scripts/b.ts", "scripts/b.ts", "src/a.py")).toBe(true);
  });

  it("resolves . and .. inside the path", () => {
    expect(matches("scripts/./x/../b.ts", "scripts/b.ts")).toBe(true);
  });

  it("does not match a path that escapes the root", () => {
    expect(matches("../b.ts", "b.ts")).toBe(false);
  });

  it("resolves from the root when the request node has no file", () => {
    const req = request("process", "node b.ts", "a.py", "c");
    const off = offer("process", "b.ts", "b.ts", "file");
    expect(processLinker.matches(req, off, contextOf({}))).toBe(true);
  });

  it("does not match another file", () => {
    expect(matches("node other.ts", "b.ts")).toBe(false);
    expect(matches("node xb.ts", "b.ts")).toBe(false);
  });

  it("does not match an offer whose path escapes the root", () => {
    const req = request("process", "node b.ts", "a.py", "c");
    const off = offer("process", "../b.ts", "b.ts", "file");
    expect(processLinker.matches(req, off, contextOf({}))).toBe(false);
  });

  it("ignores empty words", () => {
    expect(matches("  node   b.ts  ", "b.ts")).toBe(true);
  });
});

describe("process linker: label", () => {
  it("is `processo`", () => {
    expect(
      processLinker.label(
        request("process", "node b.ts", "a.py", "c"),
        offer("process", "b.ts", "b.ts", "file"),
      ),
    ).toBe("processo");
  });
});

describe("process channel through linkProject", () => {
  const nodes = [
    fileNode("a.py"),
    innerNode("a.py", "c"),
    fileNode("b.ts"),
    innerNode("b.ts", "file"),
    fileNode("e.py"),
    innerNode("e.py", "file"),
    fileNode("scripts/f.ts"),
    innerNode("scripts/f.ts", "file"),
  ];

  it("links a request to the file of another language", () => {
    const out = linkProject({
      nodes,
      offers: [offer("process", "b.ts", "b.ts", "file")],
      requests: [request("process", "node b.ts", "a.py", "c")],
    });
    expect(out.edges).toEqual([
      {
        id: `link:process:${nodeId("a.py", "c")}->${nodeId("b.ts", "file")}`,
        kind: "calls",
        source: nodeId("a.py", "c"),
        target: nodeId("b.ts", "file"),
        label: "processo",
        labelKey: "process",
      },
    ]);
  });

  it("does not link inside the same language", () => {
    const req = request("process", "python e.py", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [offer("process", "e.py", "e.py", "file")],
      requests: [req],
    });
    expect(out.edges).toEqual([]);
    expect(out.unlinked).toEqual([req]);
  });

  it("does not link a file to itself", () => {
    const req = request("process", "python a.py", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [offer("process", "a.py", "a.py", "c")],
      requests: [req],
    });
    expect(out.edges).toEqual([]);
    expect(out.unlinked).toEqual([req]);
  });

  it("leaves a request with no file as unlinked", () => {
    const req = request("process", "ls -la", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [offer("process", "b.ts", "b.ts", "file")],
      requests: [req],
    });
    expect(out.unlinked).toEqual([req]);
  });

  it("sends to ambiguous when the root and the folder reach different files", () => {
    const nodes2 = [
      ...nodes,
      fileNode("scripts/a.py"),
      innerNode("scripts/a.py", "c"),
      fileNode("scripts/b.ts"),
      innerNode("scripts/b.ts", "file"),
    ];
    const req = request("process", "node b.ts", "scripts/a.py", "c");
    const out = linkProject({
      nodes: nodes2,
      offers: [
        offer("process", "scripts/b.ts", "scripts/b.ts", "file"),
        offer("process", "b.ts", "b.ts", "file"),
      ],
      requests: [req],
    });
    expect(out.edges).toEqual([]);
    expect(out.ambiguous).toHaveLength(1);
    expect(out.ambiguous[0]?.candidates.map((c) => c.key)).toEqual([
      "b.ts",
      "scripts/b.ts",
    ]);
  });
});
