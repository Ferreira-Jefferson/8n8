import type {
  ExplainResponse,
  Graph,
  HistoryEntry,
  HistoryItem,
  NodeTitle,
  ProjectResponse,
  TitlesResponse,
} from "@code2n8n/model";

export type ExplainResult = ExplainResponse | { status: "stale" };

const JSON_HEADERS = { "content-type": "application/json" };

function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export async function fetchGraph(source: string): Promise<Graph> {
  const res = await post("/api/graph", { source });
  if (!res.ok) throw new Error(`Falha ao gerar o mapa (HTTP ${res.status})`);
  const body = (await res.json()) as { graph: Graph };
  return body.graph;
}

export type ProjectResult =
  | ProjectResponse
  | { error: "not-found"; path: string };

/** Opens a local folder; `not-found` carries the path as typed (PROJ-05). */
export async function fetchProject(path: string): Promise<ProjectResult> {
  const res = await post("/api/project", { path });
  if (res.status === 404) return { error: "not-found", path };
  if (!res.ok) throw new Error(`Falha ao abrir a pasta (HTTP ${res.status})`);
  return (await res.json()) as ProjectResponse;
}

/** Where the server reads the code to explain: the snippet or the project root (AD-015). */
export type ExplainOrigin = { source: string } | { root: string };

export async function fetchExplanation(
  origin: ExplainOrigin,
  nodeId: string,
): Promise<ExplainResult> {
  try {
    const res = await post("/api/explain", { ...origin, nodeId });
    if (res.status === 404) return { status: "stale" };
    if (res.status === 200) return (await res.json()) as ExplainResponse;
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
  const res = await fetch("/api/history");
  if (!res.ok) throw new Error(`Falha ao ler o histórico (HTTP ${res.status})`);
  const body = (await res.json()) as { items: HistoryItem[] };
  return body.items;
}

/** One saved map, whole: opening it asks no parser. */
export async function fetchHistoryEntry(id: number): Promise<HistoryEntry> {
  const res = await fetch(`/api/history/${id}`);
  if (!res.ok)
    throw new Error(`Falha ao abrir a pesquisa (HTTP ${res.status})`);
  const body = (await res.json()) as { entry: HistoryEntry };
  return body.entry;
}

export async function deleteHistory(id: number): Promise<void> {
  const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
  if (!res.ok)
    throw new Error(`Falha ao apagar a pesquisa (HTTP ${res.status})`);
}

/** Marks or unmarks a saved map as a favourite. */
export async function starHistory(id: number, starred: boolean): Promise<void> {
  const res = await fetch(`/api/history/${id}/star`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ starred }),
  });
  if (!res.ok)
    throw new Error(`Falha ao marcar o favorito (HTTP ${res.status})`);
}
