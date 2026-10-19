import type { FlowNode, SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { analyzeFiles } from "../analyze";
import { loadPythonParser } from "../parse";

const parser = await loadPythonParser();

const REPO = {
  path: "app/repo.py",
  source: [
    "class Repo:",
    "    def create(self):",
    "        return self._save()",
    "",
    "    def _save(self):",
    "        return 1",
    "",
  ].join("\n"),
};

function analysisOf(files: SourceFile[]): {
  calls: string[];
  nodes: FlowNode[];
} {
  const analysis = analyzeFiles(parser, files);
  return {
    calls: analysis.files
      .flatMap((f) => f.graph.edges)
      .filter((e) => e.kind === "calls")
      .map((e) => `${e.source} -> ${e.target}`),
    nodes: analysis.files.flatMap((f) => f.graph.nodes),
  };
}

describe("calls on a class and on an instance", () => {
  it("resolves `Class.method()` and `x = Class(); x.method()` on a class of the same file", () => {
    const { calls } = analysisOf([
      {
        path: "app/repo.py",
        source: [
          REPO.source,
          "def direct():",
          "    Repo.create(None)",
          "",
          "def by_instance():",
          "    r = Repo()",
          "    r.create()",
          "",
        ].join("\n"),
      },
    ]);

    expect(calls).toEqual([
      "file:app/repo.py/cls:Repo/fn:create -> file:app/repo.py/cls:Repo/fn:_save",
      "file:app/repo.py/fn:direct -> file:app/repo.py/cls:Repo/fn:create",
      "file:app/repo.py/fn:by_instance -> file:app/repo.py/cls:Repo",
      "file:app/repo.py/fn:by_instance -> file:app/repo.py/cls:Repo/fn:create",
    ]);
  });

  it("resolves them on a class imported from the project", () => {
    const { calls } = analysisOf([
      REPO,
      {
        path: "app/service.py",
        source: [
          "from .repo import Repo",
          "",
          "def run():",
          "    Repo.create(None)",
          "    svc = Repo()",
          "    return svc._save()",
          "",
        ].join("\n"),
      },
    ]);

    expect(calls.filter((c) => c.startsWith("file:app/service.py"))).toEqual([
      "file:app/service.py/fn:run -> file:app/repo.py/cls:Repo/fn:create",
      "file:app/service.py/fn:run -> file:app/repo.py/cls:Repo",
      "file:app/service.py/fn:run -> file:app/repo.py/cls:Repo/fn:_save",
    ]);
  });

  it("takes only an instance made before the call, in the same scope", () => {
    const { calls } = analysisOf([
      {
        path: "app/repo.py",
        source: [
          REPO.source,
          "def other():",
          "    r = Repo()",
          "    return r",
          "",
          "def elsewhere(r):",
          "    r.create()",
          "",
          "def reassigned():",
          "    r = Repo()",
          "    r = make()",
          "    r.create()",
          "",
        ].join("\n"),
      },
    ]);

    expect(calls.filter((c) => c.endsWith("cls:Repo/fn:create"))).toEqual([]);
  });

  it("never makes an external call of a project import that does not resolve", () => {
    const { nodes } = analysisOf([
      REPO,
      {
        path: "app/service.py",
        source: [
          "from .repo import Repo",
          "from .gone import helper",
          "from app.repo import missing",
          "",
          "def run():",
          "    Repo.inherited()",
          "    helper()",
          "    missing()",
          "",
        ].join("\n"),
      },
    ]);

    const kinds = nodes
      .filter((n) => n.id.startsWith("file:app/service.py/fn:run/"))
      .map((n) => n.kind);
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds).not.toContain("external");
  });
});
