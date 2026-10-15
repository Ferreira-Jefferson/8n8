import type { HistoryEntry, HistoryItem } from "@8n8/model";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchHistory, fetchHistoryEntry, starHistory } from "../../api";
import { Home } from "../Home";

vi.mock("../../api", () => ({
  fetchHistory: vi.fn(),
  fetchHistoryEntry: vi.fn(),
  starHistory: vi.fn(),
}));

const listMock = vi.mocked(fetchHistory);
const entryMock = vi.mocked(fetchHistoryEntry);
const starMock = vi.mocked(starHistory);

const now = Date.now();
const item = (
  id: number,
  title: string,
  extra: Partial<HistoryItem> = {},
): HistoryItem => ({
  id,
  kind: "snippet",
  title,
  createdAt: now - (id + 1) * 3_600_000,
  openedAt: now - id * 3_600_000 - 5000,
  openCount: 1,
  lines: 10,
  bytes: 200,
  files: 1,
  nodes: 4,
  edges: 3,
  starred: false,
  ...extra,
});

const loja = item(1, "loja", {
  kind: "project",
  root: "C:/projetos/loja",
  nodes: 62,
  starred: true,
});

beforeEach(() => {
  listMock.mockReset();
  entryMock.mockReset();
  starMock.mockReset();
});
afterEach(cleanup);

function setup(props: Partial<Parameters<typeof Home>[0]> = {}) {
  const handlers = {
    onFolderChange: vi.fn(),
    onOpenFolder: vi.fn(),
    onPaste: vi.fn(),
    onOpenEntry: vi.fn(),
    onShowHistory: vi.fn(),
  };
  render(
    <Home
      folder=""
      historyOpen={false}
      reads="O 8n8 lê os arquivos .py da pasta e das subpastas."
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

const section = (name: string) => screen.getByRole("region", { name });
const titles = (name: string) =>
  within(section(name))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("b")?.textContent);

describe("Home", () => {
  it("shows favourites first, then the 5 latest others without repeating a favourite", async () => {
    listMock.mockResolvedValue([
      item(0, "a = 0"),
      loja,
      ...[2, 3, 4, 5, 6, 7].map((i) => item(i, `a = ${i}`)),
    ]);
    setup();
    await screen.findByRole("region", { name: "Favoritos" });
    expect(titles("Favoritos")).toEqual(["loja"]);
    expect(titles("Recentes")).toEqual([
      "a = 0",
      "a = 2",
      "a = 3",
      "a = 4",
      "a = 5",
    ]);
    expect(
      within(section("Favoritos")).getByText(
        "C:/projetos/loja · 62 nós · há 1 h",
      ),
    ).toBeTruthy();
    expect(
      within(section("Recentes")).getAllByText(/^Trecho · 4 nós/),
    ).toHaveLength(5);
  });

  it("hides Favoritos when nothing is starred", async () => {
    listMock.mockResolvedValue([item(0, "a = 0")]);
    setup();
    await screen.findByRole("region", { name: "Recentes" });
    expect(screen.queryByRole("region", { name: "Favoritos" })).toBeNull();
  });

  it("explains the lists when the history is empty", async () => {
    listMock.mockResolvedValue([]);
    setup();
    expect(
      await screen.findByText(/Os mapas que você gerar aparecem aqui/),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Recentes" })).toBeNull();
  });

  it("starring a recent moves it to Favoritos; unstarring moves it back", async () => {
    listMock.mockResolvedValue([item(0, "a = 0")]);
    starMock.mockResolvedValue();
    setup();
    await screen.findByRole("region", { name: "Recentes" });
    fireEvent.click(
      screen.getByRole("button", { name: "Pôr a = 0 nos favoritos" }),
    );
    await screen.findByRole("region", { name: "Favoritos" });
    expect(starMock).toHaveBeenCalledWith(0, true);
    expect(titles("Favoritos")).toEqual(["a = 0"]);
    expect(screen.queryByRole("region", { name: "Recentes" })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Tirar a = 0 dos favoritos" }),
    );
    await screen.findByRole("region", { name: "Recentes" });
    expect(starMock).toHaveBeenLastCalledWith(0, false);
  });

  it("shows an error and keeps the star when starring fails", async () => {
    listMock.mockResolvedValue([item(0, "a = 0")]);
    starMock.mockRejectedValue(new Error("x"));
    setup();
    await screen.findByRole("region", { name: "Recentes" });
    fireEvent.click(
      screen.getByRole("button", { name: "Pôr a = 0 nos favoritos" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Não foi possível marcar o favorito.",
    );
    expect(screen.queryByRole("region", { name: "Favoritos" })).toBeNull();
  });

  it("opens a clicked map", async () => {
    const entry = { kind: "project" } as HistoryEntry;
    listMock.mockResolvedValue([loja]);
    entryMock.mockResolvedValue(entry);
    const { onOpenEntry } = setup();
    fireEvent.click(await screen.findByRole("button", { name: /^loja/ }));
    await waitFor(() => expect(onOpenEntry).toHaveBeenCalledWith(entry));
    expect(entryMock).toHaveBeenCalledWith(1);
  });

  it("shows an error when the list fails", async () => {
    listMock.mockRejectedValue(new Error("x"));
    setup();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Não foi possível ler o histórico.",
    );
  });

  it("maps the folder on the button and on Enter, and passes typed text up", async () => {
    listMock.mockResolvedValue([]);
    const { onOpenFolder, onFolderChange } = setup({ folder: "C:/x" });
    const field = screen.getByLabelText("Caminho da pasta");
    fireEvent.change(field, { target: { value: "C:/y" } });
    expect(onFolderChange).toHaveBeenCalledWith("C:/y");
    fireEvent.click(screen.getByRole("button", { name: "Mapear pasta" }));
    fireEvent.submit(field);
    expect(onOpenFolder).toHaveBeenCalledTimes(2);
  });

  it("shows the sentence it gets about what the folder reads", async () => {
    listMock.mockResolvedValue([]);
    setup({
      reads: "O 8n8 lê os arquivos .py e .ts da pasta e das subpastas.",
    });
    expect(
      screen.getByText(
        "O 8n8 lê os arquivos .py e .ts da pasta e das subpastas.",
      ),
    ).toBeTruthy();
  });

  it("Colar trecho and Ver todo o histórico call their handlers", async () => {
    listMock.mockResolvedValue([]);
    const { onPaste, onShowHistory } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Colar trecho/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Ver todo o histórico" }),
    );
    expect(onPaste).toHaveBeenCalled();
    expect(onShowHistory).toHaveBeenCalled();
  });

  it("reloads the lists when the drawer closes, not while it is open", async () => {
    listMock.mockResolvedValue([]);
    const handlers = {
      onFolderChange: vi.fn(),
      onOpenFolder: vi.fn(),
      onPaste: vi.fn(),
      onOpenEntry: vi.fn(),
      onShowHistory: vi.fn(),
    };
    const { rerender } = render(
      <Home folder="" historyOpen={false} reads="" {...handlers} />,
    );
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    rerender(<Home folder="" historyOpen reads="" {...handlers} />);
    listMock.mockResolvedValue([loja]);
    rerender(<Home folder="" historyOpen={false} reads="" {...handlers} />);
    await screen.findByRole("region", { name: "Favoritos" });
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
