import { type Graph, skeletonGraphOf } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { levelSize, projectLevel } from "../project-level";
import { mistaGraph } from "./mista-graph";

/** The levels the screen can open from a skeleton: the top and every folder. */
const folderLevels = (graph: Graph) => [
  null,
  ...graph.nodes.filter((n) => n.kind === "folder").map((n) => n.id),
];

describe("the skeleton of a mixed Python and TypeScript project", () => {
  const skeleton = skeletonGraphOf(mistaGraph);

  it("has wires across languages and inheritance across files in the full graph, so the test proves something", () => {
    expect(mistaGraph.edges.some((e) => e.id.startsWith("link:"))).toBe(true);
    expect(mistaGraph.edges.filter((e) => e.kind === "extends").length).toBe(2);
    expect(skeleton.nodes.length).toBeLessThan(mistaGraph.nodes.length);
    const lifted = folderLevels(mistaGraph).flatMap(
      (id) => projectLevel(mistaGraph, id).edges,
    );
    for (const kind of ["calls", "extends"]) {
      expect(lifted.some((e) => e.kind === kind)).toBe(true);
    }
  });

  it("gives every folder level the same nodes, wires, labels and hub as the full graph", () => {
    for (const id of folderLevels(mistaGraph)) {
      const full = projectLevel(mistaGraph, id);
      const lifted = projectLevel(skeleton, id);
      expect(lifted.nodes.map((n) => n.id)).toEqual(
        full.nodes.map((n) => n.id),
      );
      expect(lifted.edges).toEqual(full.edges);
      expect(lifted.hub?.node.id).toBe(full.hub?.node.id);
      expect(lifted.reach).toBe(full.reach);
    }
  });

  it("carries on each file the size its level has in the full graph", () => {
    const files = mistaGraph.nodes.filter((n) => n.kind === "file");
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const lean = skeleton.nodes.find((n) => n.id === file.id);
      expect(lean?.size).toBe(levelSize(mistaGraph, file));
    }
  });

  it("opens the same files the full graph opens", () => {
    for (const file of mistaGraph.nodes.filter((n) => n.kind === "file")) {
      const hasChildren = mistaGraph.nodes.some((n) => n.parentId === file.id);
      expect(skeleton.nodes.find((n) => n.id === file.id)?.openable).toBe(
        file.openable && hasChildren,
      );
    }
  });

  it("joins a proven link and one to check the same way from either graph, and counts both", () => {
    const toCheck = {
      reason: "dynamic-base" as const,
      code: "config.baseUrl",
      path: "app/cliente.py",
      line: 9,
    };
    const graph: Graph = {
      ...mistaGraph,
      edges: [
        ...mistaGraph.edges,
        {
          id: "link:http:file:app/cliente.py/fn:fechar_conta/s2->file:api/servidor.ts/mod/s1",
          kind: "calls",
          source: "file:app/cliente.py/fn:fechar_conta/s2",
          target: "file:api/servidor.ts/mod/s1",
          label: "HTTP POST /api/frete",
          toCheck,
        },
      ],
    };
    const lean = skeletonGraphOf(graph);
    for (const id of folderLevels(graph)) {
      expect(projectLevel(lean, id).edges).toEqual(
        projectLevel(graph, id).edges,
      );
    }
    const wire = projectLevel(graph, null).edges.find(
      (e) => e.kind === "calls" && e.toCheck,
    );
    expect(wire?.links).toEqual({ proven: 1, toCheck: 1 });
    expect(wire?.toCheck).toEqual(toCheck);
  });
});
