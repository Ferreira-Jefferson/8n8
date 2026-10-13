import type { ExplainResponse, Graph } from "@code2n8n/model";

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

export async function fetchExplanation(
  source: string,
  nodeId: string,
): Promise<ExplainResult> {
  try {
    const res = await post("/api/explain", { source, nodeId });
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
