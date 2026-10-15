import type { FlowNode, NodeId, Suggestion } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { projectLevel } from "../project-level";
import { highlighted, suggestionCards } from "../suggestion-cards";
import { videoGraph } from "./video-graph";

const P = "fn:processar_pedido";
const C = "fn:calcular_frete";

function suggestion(id: string, line: number, command: string): Suggestion {
  return {
    id,
    command,
    reason: "motivo",
    line,
    severity: "media",
    lines: [line],
  };
}

function explanation(suggestions: Suggestion[]): Suggestion[] {
  return suggestions;
}

/** The panel of a call is its target's panel (C10). */
const panelNodeOf = (n: FlowNode): NodeId =>
  n.kind === "call" && n.target !== undefined ? n.target : n.id;

const videoExplanation = explanation([
  suggestion("g1", 12, "Grave o pedido numa transação"),
  suggestion("g2", 13, "Envie o e-mail fora da requisição"),
]);

describe("VID-31: anchors of the suggestion cards", () => {
  it("inside processar_pedido, anchors the video suggestions on s5 and s6", () => {
    const level = projectLevel(videoGraph, P);
    const cards = suggestionCards(
      level,
      new Map([[P, videoExplanation]]),
      P,
      panelNodeOf,
    );
    expect(cards).toEqual([
      {
        key: `${P}:g1`,
        explainedId: P,
        anchorId: `${P}/s5`,
        text: "Grave o pedido numa transação",
        line: 12,
      },
      {
        key: `${P}:g2`,
        explainedId: P,
        anchorId: `${P}/s6`,
        text: "Envie o e-mail fora da requisição",
        line: 13,
      },
    ]);
  });

  it("on the main flow, the explanation of the visible trigger anchors on s5 and s6", () => {
    const level = projectLevel(videoGraph, null);
    const cards = suggestionCards(
      level,
      new Map([[P, videoExplanation]]),
      null,
      panelNodeOf,
    );
    expect(cards.map((c) => [c.explainedId, c.anchorId])).toEqual([
      [P, `${P}/s5`],
      [P, `${P}/s6`],
    ]);
  });

  it("a suggestion on a line with no visible node sticks to the visible owner of the explanation", () => {
    const level = projectLevel(videoGraph, null);
    const cards = suggestionCards(
      level,
      new Map([[C, explanation([suggestion("h1", 18, "Trate o erro HTTP")])]]),
      null,
      panelNodeOf,
    );
    expect(cards).toEqual([
      {
        key: `${C}:h1`,
        explainedId: C,
        anchorId: `${P}/s3`,
        text: "Trate o erro HTTP",
        line: 18,
      },
    ]);
  });

  it("when the owner is the level node, anchorId is null", () => {
    const level = projectLevel(videoGraph, P);
    const cards = suggestionCards(
      level,
      new Map([[P, explanation([suggestion("g0", 6, "Renomeie req")])]]),
      P,
      panelNodeOf,
    );
    expect(cards.map((c) => c.anchorId)).toEqual([null]);
  });

  it("the smallest range that holds the line wins", () => {
    const level = projectLevel(videoGraph, C);
    const cards = suggestionCards(
      level,
      new Map([
        [
          C,
          explanation([
            suggestion("a", 20, "cond"),
            suggestion("b", 23, "ret"),
          ]),
        ],
      ]),
      C,
      panelNodeOf,
    );
    expect(cards.map((c) => c.anchorId)).toEqual([`${C}/s2`, `${C}/s2/b1/s0`]);
  });

  it("on a tie of range size, the first node in level order wins", () => {
    const level = projectLevel(videoGraph, C);
    // Both returns moved onto line 21: s2/b0/s0 comes first in the level.
    const tied = {
      ...level,
      nodes: level.nodes.map((n) =>
        n.id === `${C}/s2/b1/s0` ? { ...n, range: { start: 21, end: 21 } } : n,
      ),
    };
    const cards = suggestionCards(
      tied,
      new Map([[C, explanation([suggestion("t1", 21, "x")])]]),
      C,
      panelNodeOf,
    );
    expect(cards.map((c) => c.anchorId)).toEqual([`${C}/s2/b0/s0`]);
  });

  it("a suggestion of one explanation appears once, even from two visible calls", () => {
    const level = projectLevel(videoGraph, P);
    const call = level.nodes.find((n) => n.id === `${P}/s3`) as FlowNode;
    const twice = {
      ...level,
      nodes: [...level.nodes, { ...call, id: `${P}/s9` }],
    };
    const cards = suggestionCards(
      twice,
      new Map([[C, explanation([suggestion("h1", 18, "Trate o erro HTTP")])]]),
      P,
      panelNodeOf,
    );
    expect(cards.map((c) => c.key)).toEqual([`${C}:h1`]);
    expect(cards[0]?.anchorId).toBe(`${P}/s3`);
  });

  it("gives no card without an explanation", () => {
    const level = projectLevel(videoGraph, P);
    expect(suggestionCards(level, new Map(), P, panelNodeOf)).toEqual([]);
  });
});

describe("VID-32: highlighted", () => {
  it("holds only the non-null anchors", () => {
    const set = highlighted([
      { key: "a", explainedId: P, anchorId: `${P}/s5`, text: "x", line: 12 },
      { key: "b", explainedId: P, anchorId: null, text: "y", line: 6 },
      { key: "c", explainedId: P, anchorId: `${P}/s6`, text: "z", line: 13 },
    ]);
    expect([...set]).toEqual([`${P}/s5`, `${P}/s6`]);
  });

  it("is empty with no card", () => {
    expect(highlighted([]).size).toBe(0);
  });
});
