import type { SourceFile } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { analyzeFiles } from "../analyze";
import { loadPythonParser } from "../parse";

const parser = await loadPythonParser();

/** The `calls` wires between files and the `name` requests of the analysis. */
function starsOf(files: SourceFile[]): { calls: string[]; names: string[] } {
  const analysis = analyzeFiles(parser, files);
  const calls = analysis.files
    .flatMap((f) => f.graph.edges)
    .filter((e) => e.kind === "calls")
    .map((e) => `${e.source} -> ${e.target}`);
  const names = analysis.requests
    .filter((r) => r.channel === "name")
    .map((r) => r.key);
  return { calls, names };
}

describe("from x import *", () => {
  it("resolves a call to a function of the module, and asks no name for it", () => {
    const { calls, names } = starsOf([
      { path: "py/utils.py", source: "def render(x):\n    return str(x)\n" },
      {
        path: "py/view.py",
        source: "from utils import *\n\ndef page():\n    return render(1)\n",
      },
    ]);

    expect(calls).toEqual([
      "file:py/view.py/fn:page -> file:py/utils.py/fn:render",
    ]);
    expect(names).toEqual([]);
  });

  it("follows `__all__`, skips private names and goes through a `*` of the module", () => {
    const { calls, names } = starsOf([
      {
        path: "pkg/base.py",
        source: "def deep():\n    return 0\n\ndef _hidden():\n    return 1\n",
      },
      {
        path: "pkg/mid.py",
        source: "from .base import *\n\ndef shown():\n    return 2\n",
      },
      {
        path: "pkg/only.py",
        source:
          '__all__ = ["listed"]\n\ndef listed():\n    return 3\n\ndef unlisted():\n    return 4\n',
      },
      {
        path: "pkg/use.py",
        source: [
          "from .mid import *",
          "from .only import *",
          "",
          "def run():",
          "    deep()",
          "    shown()",
          "    listed()",
          "    _hidden()",
          "    unlisted()",
          "",
        ].join("\n"),
      },
    ]);

    expect(calls).toEqual([
      "file:pkg/use.py/fn:run -> file:pkg/base.py/fn:deep",
      "file:pkg/use.py/fn:run -> file:pkg/mid.py/fn:shown",
      "file:pkg/use.py/fn:run -> file:pkg/only.py/fn:listed",
    ]);
    expect(names).toEqual(["_hidden", "unlisted"]);
  });

  it("reads `from . import *` as the package itself", () => {
    const { calls } = starsOf([
      { path: "pkg/__init__.py", source: "def setup():\n    return 1\n" },
      {
        path: "pkg/use.py",
        source: "from . import *\n\ndef run():\n    return setup()\n",
      },
    ]);

    expect(calls).toEqual([
      "file:pkg/use.py/fn:run -> file:pkg/__init__.py/fn:setup",
    ]);
  });

  it("asks no name when a relative `*` names a module the project does not have", () => {
    const { names } = starsOf([
      {
        path: "pkg/use.py",
        source: "from .gone import *\n\ndef run():\n    return render(1)\n",
      },
    ]);

    expect(names).toEqual([]);
  });

  it("still asks a name when the `*` comes from a library", () => {
    const { names } = starsOf([
      {
        path: "use.py",
        source: "from tkinter import *\n\ndef run():\n    return render(1)\n",
      },
    ]);

    expect(names).toEqual(["render"]);
  });
});
