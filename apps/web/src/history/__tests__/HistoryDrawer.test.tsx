import type { HistoryEntry, HistoryItem } from "@code2n8n/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteHistory,
  fetchHistory,
  fetchHistoryEntry,
  starHistory,
} from "../../api";
import { HistoryDrawer, humanBytes, relativeDate } from "../HistoryDrawer";

vi.mock("../../api", () => ({
  fetchHistory: vi.fn(),
  fetchHistoryEntry: vi.fn(),
  deleteHistory: vi.fn(),
  starHistory: vi.fn(),
}));

const listMock = vi.mocked(fetchHistory);
const entryMock = vi.mocked(fetchHistoryEntry);
const deleteMock = vi.mocked(deleteHistory);
const starMock = vi.mocked(starHistory);

const now = Date.now();
const snippet: HistoryItem = {
  id: 1,
  kind: "snippet",
  title: "def calcular_frete(peso):",
  createdAt: now - 3 * 3_600_000,
  openedAt: now - 2 * 3_600_000 - 5000,
  openCount: 1,
  lines: 12,
  bytes: 12 * 1024,
  files: 1,
  nodes: 5,
  edges: 4,
  starred: false,
};
const project: HistoryItem = {
  ...snippet,
  id: 2,
  kind: "project",
  title: "loja",
  root: "C:/codigo/loja",
  lines: 300,
  files: 7,
  nodes: 40,
};

beforeEach(() => {
  listMock.mockReset();
  entryMock.mockReset();
  deleteMock.mockReset();
  starMock.mockReset();
  listMock.mockResolvedValue([snippet, project]);
});
afterEach(cleanup);

function setup() {
  const onClose = vi.fn();
  const onOpenEntry = vi.fn();
  render(<HistoryDrawer onClose={onClose} onOpenEntry={onOpenEntry} />);
  return { onClose, onOpenEntry };
}

describe("HistoryDrawer", () => {
  it("lists each item with tag, sizes and relative date, and focuses the search", async () => {
    setup();
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("TRECHO")).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText("há 2 h")).toBeTruthy();
    expect(
      within(rows[0] as HTMLElement).getByText(
        "12 linhas · 1 arquivo · 5 nós · 12 KB",
      ),
    ).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText("PASTA")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("searchbox", { name: "Buscar no histórico" }),
    );
  });

  it("filters by title or root", async () => {
    setup();
    await screen.findAllByRole("listitem");
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "codigo/lo" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(box, { target: { value: "FRETE" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText("Nada encontrado.")).toBeTruthy();
  });

  it("deletes a row", async () => {
    deleteMock.mockResolvedValue();
    setup();
    await screen.findAllByRole("listitem");
    fireEvent.click(screen.getByRole("button", { name: "Apagar loja" }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
    expect(deleteMock).toHaveBeenCalledWith(2);
  });

  it("stars a row and unstars it again", async () => {
    starMock.mockResolvedValue();
    setup();
    await screen.findAllByRole("listitem");
    const on = screen.getByRole("button", { name: "Pôr loja nos favoritos" });
    expect(on.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(on);
    const off = await screen.findByRole("button", {
      name: "Tirar loja dos favoritos",
    });
    expect(off.getAttribute("aria-pressed")).toBe("true");
    expect(starMock).toHaveBeenCalledWith(2, true);
    fireEvent.click(off);
    await screen.findByRole("button", { name: "Pôr loja nos favoritos" });
    expect(starMock).toHaveBeenLastCalledWith(2, false);
  });

  it("keeps the star as it was when starring fails", async () => {
    starMock.mockRejectedValue(new Error("x"));
    setup();
    await screen.findAllByRole("listitem");
    fireEvent.click(
      screen.getByRole("button", { name: "Pôr loja nos favoritos" }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Pôr loja nos favoritos" }),
    ).toBeTruthy();
  });

  it("shows an error line when the delete fails", async () => {
    deleteMock.mockRejectedValue(new Error("x"));
    setup();
    await screen.findAllByRole("listitem");
    fireEvent.click(screen.getByRole("button", { name: "Apagar loja" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("says so when nothing is saved", async () => {
    listMock.mockResolvedValue([]);
    setup();
    expect(await screen.findByText("Nenhuma pesquisa guardada.")).toBeTruthy();
  });

  it("shows an error line when the list fails", async () => {
    listMock.mockRejectedValue(new Error("x"));
    setup();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("hands the entry of a clicked row to the caller", async () => {
    const entry: HistoryEntry = {
      kind: "project",
      root: "C:/codigo/loja",
      response: {} as never,
    };
    entryMock.mockResolvedValue(entry);
    const { onOpenEntry } = setup();
    await screen.findAllByRole("listitem");
    fireEvent.click(screen.getByRole("button", { name: /loja.*PASTA/ }));
    await waitFor(() => expect(onOpenEntry).toHaveBeenCalledWith(entry));
    expect(entryMock).toHaveBeenCalledWith(2);
  });

  it("closes on Esc and on a click outside, not on a click inside", async () => {
    const { onClose } = setup();
    await screen.findAllByRole("listitem");
    fireEvent.mouseDown(screen.getByRole("searchbox"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("closes on a click outside even when the target stops the mousedown (the map pane does)", async () => {
    const { onClose } = setup();
    await screen.findAllByRole("listitem");
    const pane = document.createElement("div");
    pane.addEventListener("mousedown", (e) => e.stopImmediatePropagation());
    document.body.append(pane);
    fireEvent.mouseDown(pane);
    expect(onClose).toHaveBeenCalledTimes(1);
    pane.remove();
  });
});

describe("history formats", () => {
  it("writes short pt-BR ages", () => {
    expect(relativeDate(1000, 1000 + 30_000)).toBe("agora");
    expect(relativeDate(0, 5 * 60_000)).toBe("há 5 min");
    expect(relativeDate(0, 3 * 86_400_000)).toBe("há 3 d");
  });

  it("writes bytes in human form", () => {
    expect(humanBytes(900)).toBe("900 B");
    expect(humanBytes(12 * 1024)).toBe("12 KB");
    expect(humanBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
