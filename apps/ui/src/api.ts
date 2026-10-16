import type {
  ChatResponse,
  ChatSuggestion,
  ChatTurn,
  ExplainPart,
  ExplainResponse,
  GraphResponse,
  HistoryEntry,
  HistoryItem,
  LanguageInfo,
  LanguagesResponse,
  NodeNotes,
  NodeTitle,
  ProjectResponse,
  SettingsPatch,
  SettingsResponse,
  StructureResponse,
  Suggestion,
  Summary,
  TitlesResponse,
} from "@8n8/model";
import { bridgeFetch, vscodeHost } from "./vscode-host";

/** One part's answer, or `stale` when the server no longer has the node (404). */
export type ExplainResult<T> = ExplainResponse<T> | { status: "stale" };
export type SummaryResult = ExplainResult<Summary>;
export type SuggestionsResult = ExplainResult<Suggestion[]>;

const JSON_HEADERS = { "content-type": "application/json" };

/** The token the CLI opened this tab with; the server answers 401 without it (DIST-19). */
let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

/** Every call to the server goes through here, so none leaves without the token. In the VS Code webview it goes through the extension instead (VSC-04). */
function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const host = vscodeHost();
  if (host) return bridgeFetch(host, url, init);
  const headers = new Headers(init.headers);
  if (sessionToken !== null) headers.set("x-8n8-token", sessionToken);
  return fetch(url, { ...init, headers });
}

function post(url: string, body: unknown): Promise<Response> {
  return apiFetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** The graph of a snippet, with the language the server detected. */
export async function fetchGraph(source: string): Promise<GraphResponse> {
  const res = await post("/api/graph", { source });
  if (!res.ok) throw new Error(`Falha ao gerar o mapa (HTTP ${res.status})`);
  return (await res.json()) as GraphResponse;
}

/** The languages the server reads; any failure gives `[]`, and the screen keeps its generic texts. */
export async function fetchLanguages(): Promise<LanguageInfo[]> {
  try {
    const res = await apiFetch("/api/languages");
    if (!res.ok) return [];
    const body = (await res.json()) as LanguagesResponse;
    return body.languages ?? [];
  } catch {
    return [];
  }
}

export type ProjectResult =
  | ProjectResponse
  | { error: "not-found"; path: string; dependency?: true };

/** Opens a local folder; `not-found` carries the path as typed (PROJ-05). `include`: files over 1 MB put on the map (CLEAN-06). */
export async function fetchProject(
  path: string,
  include: string[] = [],
): Promise<ProjectResult> {
  const res = await post("/api/project", {
    path,
    ...(include.length > 0 ? { include } : {}),
  });
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as {
      dependency?: boolean;
    };
    return {
      error: "not-found",
      path,
      ...(body.dependency ? { dependency: true as const } : {}),
    };
  }
  if (!res.ok) throw new Error(`Falha ao abrir a pasta (HTTP ${res.status})`);
  return (await res.json()) as ProjectResponse;
}

/** Opens the system's chooser on this machine; `null` when the person cancels. */
export async function fetchPick(
  kind: "folder" | "file" | "any",
): Promise<string | null> {
  const res = await post("/api/pick", { kind });
  if (!res.ok) throw new Error(`Falha ao abrir o seletor (HTTP ${res.status})`);
  return ((await res.json()) as { path: string | null }).path;
}

/**
 * Where the server reads the code to explain: the snippet, or the project root with the
 * files over 1 MB put on the map, so it reads the folder the screen shows (AD-015, CLEAN-07).
 */
export type ExplainOrigin =
  | { source: string }
  | { root: string; include?: string[] };

/** One part of a node's explanation; `cachedOnly` asks the cache and never spends the LLM (CFG-05). */
async function fetchPart<T>(
  part: ExplainPart,
  origin: ExplainOrigin,
  nodeId: string,
  cachedOnly: boolean,
): Promise<ExplainResult<T>> {
  try {
    const res = await post(`/api/${part}`, {
      ...origin,
      nodeId,
      ...(cachedOnly ? { cachedOnly } : {}),
    });
    if (res.status === 404) return { status: "stale" };
    if (res.status === 200) return (await res.json()) as ExplainResponse<T>;
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    return {
      status: "error",
      message: body?.message ?? `Falha na explicação (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Falha de rede",
    };
  }
}

/** One answer of the chat, or `stale` when the server no longer has the node (404). */
export type ChatResult = ChatResponse | { status: "stale" };

/** One question about a node and its parent; `history` is the past of the conversation (the server keeps none). */
export async function fetchChat(
  origin: ExplainOrigin,
  nodeId: string,
  history: ChatTurn[],
  question: string,
): Promise<ChatResult> {
  try {
    const res = await post("/api/chat", {
      ...origin,
      nodeId,
      history,
      question,
    });
    if (res.status === 404) return { status: "stale" };
    const body = (await res.json().catch(() => null)) as ChatResponse | null;
    if (body && (res.status === 200 || body.status === "error")) return body;
    return {
      status: "error",
      message: `Falha na conversa (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Falha de rede",
    };
  }
}

/** What the person asks of the notes of a node: read them, keep a suggestion, remove a kept one, or remove a generated one. */
export type NotesOp =
  | { action: "get" }
  | { action: "save"; suggestion: ChatSuggestion }
  | { action: "unsave"; id: string }
  | { action: "dismiss"; command: string; reason: string };

/** The notes of a node after the op; null when the server cannot answer (the screen then keeps what it had). */
export async function fetchNotes(
  origin: ExplainOrigin,
  nodeId: string,
  op: NotesOp,
): Promise<NodeNotes | null> {
  try {
    const res = await post("/api/notes", { ...origin, nodeId, ...op });
    return res.ok ? ((await res.json()) as NodeNotes) : null;
  } catch {
    return null;
  }
}

/** An answer of the chat shaped into a suggestion, or `stale` when the server no longer has the node (404). */
export type StructureResult = StructureResponse | { status: "stale" };

export async function fetchStructure(
  origin: ExplainOrigin,
  nodeId: string,
  text: string,
): Promise<StructureResult> {
  try {
    const res = await post("/api/chat/structure", { ...origin, nodeId, text });
    if (res.status === 404) return { status: "stale" };
    const body = (await res
      .json()
      .catch(() => null)) as StructureResponse | null;
    if (body && (res.status === 200 || body.status === "error")) return body;
    return {
      status: "error",
      message: `Falha na conversa (HTTP ${res.status})`,
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Falha de rede",
    };
  }
}

/** The summary, inputs and outputs of a node (CFG-01). */
export function fetchSummary(
  origin: ExplainOrigin,
  nodeId: string,
  cachedOnly = false,
): Promise<SummaryResult> {
  return fetchPart("summary", origin, nodeId, cachedOnly);
}

/** The suggestions of a node (CFG-02). */
export function fetchSuggestions(
  origin: ExplainOrigin,
  nodeId: string,
  cachedOnly = false,
): Promise<SuggestionsResult> {
  return fetchPart("suggestions", origin, nodeId, cachedOnly);
}

/** The effective settings, never the key; null when the server cannot answer (the screen then asks for each part on click). */
export async function fetchSettings(): Promise<SettingsResponse | null> {
  try {
    const res = await apiFetch("/api/settings");
    if (!res.ok) return null;
    return (await res.json()) as SettingsResponse;
  } catch {
    return null;
  }
}

/** Saves the changed fields; null when the server refuses them or fails (CFG-21). */
export async function saveSettings(
  patch: SettingsPatch,
): Promise<SettingsResponse | null> {
  try {
    const res = await apiFetch("/api/settings", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    return (await res.json()) as SettingsResponse;
  } catch {
    return null;
  }
}

/**
 * "pick" opens the system's file chooser on the server's machine and stores the claude chosen;
 * "auto" goes back to the automatic lookup. The path never travels from here (CC-18).
 */
export async function setClaudePath(
  action: "pick" | "auto",
): Promise<SettingsResponse | "not-claude" | null> {
  try {
    const res = await apiFetch("/api/settings/claude-path", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ action }),
    });
    if (res.status === 400) return "not-claude";
    if (!res.ok) return null;
    return (await res.json()) as SettingsResponse;
  } catch {
    return null;
  }
}

/** The reviewed titles of a level, in one request; any failure gives `[]`, and the cards keep their provisional names (VID-14, 15). */
export async function fetchTitles(
  origin: ExplainOrigin,
  nodeIds: string[],
): Promise<NodeTitle[]> {
  try {
    const res = await post("/api/titles", { ...origin, nodeIds });
    if (res.status !== 200) return [];
    const body = (await res.json()) as TitlesResponse;
    return body.titles ?? [];
  } catch {
    return [];
  }
}

/** The saved searches, most recently opened first. */
export async function fetchHistory(): Promise<HistoryItem[]> {
  const res = await apiFetch("/api/history");
  if (!res.ok) throw new Error(`Falha ao ler o histórico (HTTP ${res.status})`);
  const body = (await res.json()) as { items: HistoryItem[] };
  return body.items;
}

/** One saved map, whole: opening it asks no parser. */
export async function fetchHistoryEntry(id: number): Promise<HistoryEntry> {
  const res = await apiFetch(`/api/history/${id}`);
  if (!res.ok)
    throw new Error(`Falha ao abrir a pesquisa (HTTP ${res.status})`);
  const body = (await res.json()) as { entry: HistoryEntry };
  return body.entry;
}

export async function deleteHistory(id: number): Promise<void> {
  const res = await apiFetch(`/api/history/${id}`, { method: "DELETE" });
  if (!res.ok)
    throw new Error(`Falha ao apagar a pesquisa (HTTP ${res.status})`);
}

/** Marks or unmarks a saved map as a favourite. */
export async function starHistory(id: number, starred: boolean): Promise<void> {
  const res = await apiFetch(`/api/history/${id}/star`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ starred }),
  });
  if (!res.ok)
    throw new Error(`Falha ao marcar o favorito (HTTP ${res.status})`);
}
