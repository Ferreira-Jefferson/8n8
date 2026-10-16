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
});
