import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";

// OpenAI-compatible fake LLM for the E2E of feature 04. The keyed server points
// OPENROUTER_BASE_URL here, so the real review pipeline runs without the network.
// Answers are scripted by request content; any other content gets 500 so an
// unexpected call fails loudly.

const PORT = 4318;
export const FAKE_URL = `http://127.0.0.1:${PORT}`;
/** The only key the fake accepts: a real key reaching it is a test setup bug. */
const FAKE_KEY = "e2e-fake-key";

interface Message {
  role: string;
  content: string;
}

export interface FakeCall {
  role: "draft" | "review";
  model: string;
  messages: Message[];
}

interface Suggestion {
  command: string;
  reason: string;
  line: number;
  severity: "alta" | "media" | "baixa";
}

interface Scenario {
  /** Found in a user message when the request is about this node. */
  marker: string;
  draft: {
    summary: string;
    inputs: string[];
    outputs: string[];
    suggestions: Suggestion[];
  };
  /** Claim text (as the reviewer gets it) → relative evidence lines. */
  evidence: Record<string, number[]>;
}

const FRETE_SUGGESTION: Suggestion = {
  command: "Guardar a tabela de frete em cache",
  reason: "A função busca a tabela na rede a cada chamada.",
  line: 2,
  severity: "media",
};

const SCENARIOS: Scenario[] = [
  {
    marker: "def calcular_frete",
    draft: {
      summary:
        "Busca a tabela de frete com `requests.get`. Dobra a taxa quando `peso` passa de 30.",
      inputs: ["`peso`", "`distancia`"],
      outputs: ["valor do frete"],
      suggestions: [FRETE_SUGGESTION],
    },
    evidence: {
      "Busca a tabela de frete com `requests.get`.": [2],
      "Dobra a taxa quando `peso` passa de 30.": [5, 6],
      "`peso`": [1],
      "`distancia`": [1],
      "valor do frete": [6, 8],
      [`${FRETE_SUGGESTION.command} ${FRETE_SUGGESTION.reason}`]: [2],
    },
  },
  {
    marker: "def pesar_caixa",
    draft: {
      summary: "Devolve o peso da caixa. A caixa pesa 5 kg.",
      inputs: ["`caixa`"],
      outputs: ["peso da caixa"],
      suggestions: [],
    },
    evidence: {
      "Devolve o peso da caixa.": [2],
      "`caixa`": [1],
      "peso da caixa": [2],
    },
  },
  {
    marker: "def esperar",
    draft: {
      summary: "Espera 10 segundos.",
      inputs: [],
      outputs: [],
      suggestions: [],
    },
    evidence: {},
  },
  {
    // FID-04: the reviewer would accept the invented identifier; only layer one stops it.
    marker: "def somar_itens",
    draft: {
      summary:
        "Soma os itens da lista. Chama `calcular_imposto` antes de somar.",
      inputs: ["`itens`"],
      outputs: ["soma dos itens"],
      suggestions: [],
    },
    evidence: {
      "Soma os itens da lista.": [2],
      "Chama `calcular_imposto` antes de somar.": [2],
      "`itens`": [1],
      "soma dos itens": [2],
    },
  },
  {
    // FID-07: two sentences the reviewer calls supported, one with a line
    // outside the node (3 lines) and one with no line at all.
    marker: "def contar_partes",
    draft: {
      summary:
        "Divide o texto em partes. Devolve o total de partes. Ignora as partes vazias.",
      inputs: ["`texto`"],
      outputs: ["total de partes"],
      suggestions: [],
    },
    evidence: {
      "Divide o texto em partes.": [2],
      "Devolve o total de partes.": [99],
      "Ignora as partes vazias.": [],
      "`texto`": [1],
      "total de partes": [3],
    },
  },
];

/** Verdicts for each `- <id>: <text>` line of the reviewer request. */
function verdicts(user: string, scenario: Scenario): string {
  const items = user.split("\n").flatMap((line) => {
    const m = /^- (\S+): (.*)$/.exec(line);
    return m ? [{ id: m[1] as string, text: m[2] as string }] : [];
  });
  return JSON.stringify({
    verdicts: items.map(({ id, text }) => {
      const lines = scenario.evidence[text];
      return lines
        ? { id, supported: true, evidence: lines }
        : { id, supported: false, evidence: [], problem: "sem evidência" };
    }),
  });
}

/** Scripted answer, or undefined for content the script does not know. */
function answer(call: FakeCall): string | undefined {
  const users = call.messages.filter((m) => m.role === "user");
  const scenario = SCENARIOS.find((s) =>
    users.some((m) => m.content.includes(s.marker)),
  );
  if (!scenario) return undefined;
  if (call.role === "draft") return JSON.stringify(scenario.draft);
  return verdicts(users.at(-1)?.content ?? "", scenario);
}

function completion(model: string, content: string) {
  return {
    id: "chatcmpl-e2e",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function startFake(): void {
  let log: FakeCall[] = [];
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && req.url === "/__log") return send(200, log);
    if (req.method === "POST" && req.url === "/__reset") {
      log = [];
      return send(200, { ok: true });
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      return send(404, { error: { message: "not found" } });
    }
    if (req.headers.authorization !== `Bearer ${FAKE_KEY}`) {
      return send(401, { error: { message: "unexpected key" } });
    }
    const body = JSON.parse(await readBody(req)) as {
      model: string;
      messages: Message[];
    };
    const system = body.messages.find((m) => m.role === "system");
    const call: FakeCall = {
      role: system?.content.includes('"verdicts"') ? "review" : "draft",
      model: body.model,
      messages: body.messages,
    };
    log.push(call);
    const content = answer(call);
    if (content === undefined) {
      return send(500, { error: { message: "fake llm: unscripted request" } });
    }
    send(200, completion(body.model, content));
  });
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`fake llm em ${FAKE_URL}`);
  });
}

/** Clears the call log. */
export async function resetFake(): Promise<void> {
  const res = await fetch(`${FAKE_URL}/__reset`, { method: "POST" });
  if (!res.ok) throw new Error(`fake llm reset: ${res.status}`);
}

/** Every chat completion request since the last reset, in order. */
export async function fakeLog(): Promise<FakeCall[]> {
  const res = await fetch(`${FAKE_URL}/__log`);
  return (await res.json()) as FakeCall[];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startFake();
}
