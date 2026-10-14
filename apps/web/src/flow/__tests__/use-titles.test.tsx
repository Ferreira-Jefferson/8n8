import type { FlowNode, NodeKind, NodeTitle } from "@code2n8n/model";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type ExplainOrigin, fetchTitles } from "../../api";
import { useTitles } from "../use-titles";

vi.mock("../../api", () => ({ fetchTitles: vi.fn() }));
const fetchMock = vi.mocked(fetchTitles);

beforeEach(() => fetchMock.mockReset());

const origin: ExplainOrigin = { source: "x = 1" };
const P = "fn:processar_pedido";
const top = [P, ...[0, 1, 2, 3, 4, 5, 6].map((i) => `${P}/s${i}`)];

function title(nodeId: string, text: string): NodeTitle {
  return { nodeId, text, lines: [1], fromCache: false };
}

function node(id: string, kind: NodeKind = "function"): FlowNode {
  return {
    id,
    kind,
    label: id,
    parentId: null,
    range: { start: 1, end: 1 },
    openable: true,
  };
}

interface Props {
  version: number;
  ids: string[];
  /** Nodes given as they are, for folder and file kinds. */
  nodes?: FlowNode[];
}

function setup(initial: Props) {
  return renderHook(
    ({ version, ids, nodes }: Props) =>
      useTitles(origin, version, nodes ?? ids.map((id) => node(id))),
    { initialProps: initial },
  );
}

describe("useTitles (VID-14, VID-15)", () => {
  it("asks once for the 8 IDs of a level and returns their titles", async () => {
    fetchMock.mockResolvedValue(top.map((id) => title(id, `T ${id}`)));
    const { result } = setup({ version: 1, ids: top });
    await waitFor(() => expect(result.current.size).toBe(8));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(origin, top);
    expect(result.current.get(`${P}/s5`)).toBe(`T ${P}/s5`);
  });

  it("does not ask again for the same level", async () => {
    fetchMock.mockResolvedValue(top.map((id) => title(id, `T ${id}`)));
    const { result, rerender } = setup({ version: 1, ids: top });
    await waitFor(() => expect(result.current.size).toBe(8));
    rerender({ version: 1, ids: ["fn:calcular_frete"] });
    rerender({ version: 1, ids: [...top] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(origin, ["fn:calcular_frete"]);
  });

  it("asks only for the 2 IDs it does not know yet", async () => {
    const known = ["a", "b", "c"];
    fetchMock.mockResolvedValue(known.map((id) => title(id, id)));
    const { result, rerender } = setup({ version: 1, ids: known });
    await waitFor(() => expect(result.current.size).toBe(3));
    fetchMock.mockResolvedValue([title("d", "d"), title("e", "e")]);
    rerender({ version: 1, ids: ["a", "b", "c", "d", "e"] });
    await waitFor(() => expect(result.current.size).toBe(5));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(origin, ["d", "e"]);
  });

  it("leaves dir: and file: IDs out of the request", async () => {
    fetchMock.mockResolvedValue([]);
    setup({
      version: 1,
      ids: [],
      nodes: [
        node("dir:frete", "folder"),
        node("file:frete/calculo.py", "file"),
        node("file:frete/calculo.py/fn:f"),
      ],
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(origin, [
      "file:frete/calculo.py/fn:f",
    ]);
  });

  it("makes no request when every ID is a folder or a file", async () => {
    setup({
      version: 1,
      ids: [],
      nodes: [
        node("dir:frete", "folder"),
        node("file:frete/calculo.py", "file"),
      ],
    });
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a title for a node that was not asked for", async () => {
    fetchMock.mockResolvedValue([title("a", "A"), title("intruso", "X")]);
    const { result } = setup({ version: 1, ids: ["a"] });
    await waitFor(() => expect(result.current.get("a")).toBe("A"));
    expect(result.current.has("intruso")).toBe(false);
    expect(result.current.size).toBe(1);
  });

  it("drops the answer of an old map version", async () => {
    let answer: (t: NodeTitle[]) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    fetchMock.mockResolvedValueOnce([title("b", "B")]);
    const { result, rerender } = setup({ version: 1, ids: ["a"] });
    rerender({ version: 2, ids: ["b"] });
    await waitFor(() => expect(result.current.get("b")).toBe("B"));
    await act(async () => answer([title("a", "A")]));
    expect(result.current.has("a")).toBe(false);
    expect(result.current.size).toBe(1);
  });

  it("empties the titles on a new map version and asks again", async () => {
    fetchMock.mockResolvedValue([title("a", "A")]);
    const { result, rerender } = setup({ version: 1, ids: ["a"] });
    await waitFor(() => expect(result.current.get("a")).toBe("A"));
    let answer: (t: NodeTitle[]) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    rerender({ version: 2, ids: ["a"] });
    expect(result.current.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => answer([title("a", "A2")]));
    expect(result.current.get("a")).toBe("A2");
  });
});
