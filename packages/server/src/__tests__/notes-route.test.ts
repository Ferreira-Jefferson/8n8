import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNotesStore } from "@8n8/explain";
import { pythonPlugin } from "@8n8/lang-python";
import type {
  NodeNotes,
  StructureRequest,
  StructureResponse,
} from "@8n8/model";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { TEST_TOKEN } from "./test-token";

const fixture = [
  "import requests",
  "",
  "",
  "def calcular_frete(peso):",
  '    r = requests.get("https://x.test/tabela")',
  "    base = 10",
  "    return base",
  "",
].join("\n");
// The first step of the function: line 5.
const STEP = "fn:calcular_frete/s0";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "8n8-notes-route-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function setup(reply: StructureResponse = { status: "none" }) {
  const asked: StructureRequest[] = [];
  const app = createApp({
    plugins: [pythonPlugin],
    explain: async () => ({ status: "not-cached" }),
    titles: async () => ({ status: "ok", titles: [] }),
    structure: async (req) => {
      asked.push(req);
      return reply;
    },
    notes: (locale) => createNotesStore(dir, locale),
    readProject: async () => ({ kind: "not-found" }),
    port: 8148,
    token: TEST_TOKEN,
  });
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: {
        host: "127.0.0.1:8148",
        "x-8n8-token": TEST_TOKEN,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const notes = async (extra: object, source = fixture, nodeId = STEP) => {
    const res = await post("/api/notes", { source, nodeId, ...extra });
    return { status: res.status, body: (await res.json()) as NodeNotes };
  };
  return { asked, post, notes };
}

const kept = {
  command: "Defina um timeout.",
  reason: "A chamada pode travar.",
  line: 5,
  severity: "media",
};

describe("POST /api/notes", () => {
  it("starts empty", async () => {
    const { notes } = setup();
    expect(await notes({ action: "get" })).toEqual({
      status: 200,
      body: { saved: [], dismissed: [] },
    });
  });

  it("keeps a suggestion with its absolute line and gives it back on the next read", async () => {
    const { notes } = setup();
    const saved = await notes({ action: "save", suggestion: kept });
    expect(saved.status).toBe(200);
    expect(saved.body.saved).toEqual([
      {
        id: "chat-1",
        origin: "chat",
        ...kept,
        lines: [5],
      },
    ]);
    expect((await notes({ action: "get" })).body.saved).toHaveLength(1);
    // The same text again is the same suggestion.
    expect(
      (await notes({ action: "save", suggestion: kept })).body.saved,
    ).toHaveLength(1);
  });

  it("keeps lines that follow the node when the file moves down", async () => {
    const { notes } = setup();
    await notes({ action: "save", suggestion: kept });
    const moved = `\n\n\n${fixture}`;
    // The code of the node is the same: the suggestion comes back, 3 lines lower.
    const res = await notes({ action: "get" }, moved);
    expect(res.body.saved[0]?.line).toBe(8);
    expect(res.body.saved[0]?.lines).toEqual([8]);
  });

  it("forgets the notes of a node whose code changed", async () => {
    const { notes } = setup();
    await notes({ action: "save", suggestion: kept });
    const changed = fixture.replace("requests.get(", "requests.post(");
    expect((await notes({ action: "get" }, changed)).body.saved).toEqual([]);
  });

  it("removes a kept suggestion by its id", async () => {
    const { notes } = setup();
    await notes({ action: "save", suggestion: kept });
    expect(
      (await notes({ action: "unsave", id: "chat-1" })).body.saved,
    ).toEqual([]);
  });

  it("remembers a removed generated suggestion by its text", async () => {
    const { notes } = setup();
    const res = await notes({
      action: "dismiss",
      command: "Guardar em cache",
      reason: "Busca a tabela a cada chamada.",
    });
    expect(res.body.dismissed).toEqual([
      "guardar em cache\nbusca a tabela a cada chamada.",
    ]);
    expect((await notes({ action: "get" })).body.dismissed).toHaveLength(1);
  });

  it("refuses a suggestion outside the node, an unknown action and a bad body", async () => {
    const { notes, post } = setup();
    expect(
      (await notes({ action: "save", suggestion: { ...kept, line: 1 } }))
        .status,
    ).toBe(400);
    expect((await notes({ action: "save", suggestion: "x" })).status).toBe(400);
    expect((await notes({ action: "burn" })).status).toBe(400);
    expect((await post("/api/notes", { nodeId: STEP })).status).toBe(400);
    expect(
      (await notes({ action: "get" }, fixture, "fn:nao_existe")).status,
    ).toBe(404);
  });
});

describe("POST /api/chat/structure", () => {
  it("builds the context from its own graph and passes the text on", async () => {
    const { asked, post } = setup({
      status: "ok",
      suggestion: { ...kept },
    } as StructureResponse);
    const res = await post("/api/chat/structure", {
      source: fixture,
      nodeId: STEP,
      text: "  Defina um timeout (L5).  ",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
    expect(asked[0]?.text).toBe("Defina um timeout (L5).");
    expect(asked[0]?.range.start).toBe(5);
    expect(asked[0]?.parent?.name).toBe("calcular_frete");
  });

  it("answers none, and refuses an empty text", async () => {
    const { post } = setup({ status: "none" });
    const none = await post("/api/chat/structure", {
      source: fixture,
      nodeId: STEP,
      text: "Nada.",
    });
    expect(await none.json()).toEqual({ status: "none" });
    expect(
      (
        await post("/api/chat/structure", {
          source: fixture,
          nodeId: STEP,
          text: " ",
        })
      ).status,
    ).toBe(400);
  });
});
