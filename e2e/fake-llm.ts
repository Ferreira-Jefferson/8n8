import { createServer, type IncomingMessage } from "node:http";
import { pathToFileURL } from "node:url";
import { LANE_PORT, lanePort } from "./lane";

// OpenAI-compatible fake LLM for the E2E of features 04 and 05. The keyed server points
// OPENROUTER_BASE_URL here, so the real review pipeline runs without the network.
// Answers are scripted by request content; any other content gets 500 so an
// unexpected call fails loudly.

// The config starts one fake per lane with E2E_FAKE_PORT; a worker talks to its lane's.
const PORT = Number(process.env.E2E_FAKE_PORT ?? lanePort(LANE_PORT.fake));
const FAKE_URL = `http://127.0.0.1:${PORT}`;
/** The only key the fake accepts: a real key reaching it is a test setup bug. */
const FAKE_KEY = "e2e-fake-key";

interface Message {
  role: string;
  content: string;
}

export interface FakeCall {
  /** draft and review: the summary; suggest and suggest-review: the suggestions (feature 08). */
  role:
    | "draft"
    | "review"
    | "suggest"
    | "suggest-review"
    | "title"
    | "title-review"
    /** The chat of a node (a question and its answer). */
    | "chat"
    /** The text of an answer shaped into a suggestion. */
    | "structure";
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
    /** Scripts the optional `docstring` field of the answer. */
    docstring?: { reflects: boolean; reason: string };
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

const PEDIDO_SUGGESTIONS: Suggestion[] = [
  {
    command: "Grave o pedido numa transação",
    reason: "A chamada `db.salvar` grava sem transação.",
    line: 7,
    severity: "alta",
  },
  {
    command: "Envie o e-mail por uma fila",
    reason: "A chamada `enviar_email` bloqueia o pedido.",
    line: 8,
    severity: "media",
  },
];

const VIDEO_FRETE_SUGGESTION: Suggestion = {
  command: "Trate o erro da chamada HTTP",
  reason: "A chamada `requests.get` falha sem resposta da API.",
  line: 2,
  severity: "alta",
};

/** Key of a suggestion in `evidence`: command and reason, as the reviewer gets them. */
const said = (s: Suggestion) => `${s.command} ${s.reason}`;

/** The docstring verdict; the server turns it into a suggestion the reviewer gets as `command reason`. */
const DOC_LIE = "A docstring fala de soma de preços, mas o código usa `len`.";
const DOC_SUGGESTION = `Atualize a docstring: ${DOC_LIE.replace(/\.$/, "")} A docstring não reflete o que o código faz.`;

const SCENARIOS: Scenario[] = [
  // A whole file (ver-sem-entrar.e2e.ts): only its code has the imports of the top,
  // and the reviewer gets the code alone. First: the file also holds its functions.
  {
    marker: "from stock import reserve_items",
    draft: {
      summary:
        "O arquivo processa um pedido em `process_order`. O arquivo valida os itens do pedido em `validate_order`.",
      inputs: [],
      outputs: [],
      suggestions: [],
    },
    evidence: {
      "O arquivo processa um pedido em `process_order`.": [8],
      "O arquivo valida os itens do pedido em `validate_order`.": [18],
    },
  },
  // Docstring E2E (e2e/docstring.e2e.ts). The model sees the docstring masked.
  {
    marker: "def total_mentiroso",
    draft: {
      summary:
        "A função conta os itens com `len`. A função imprime a contagem.",
      inputs: ["`itens`"],
      outputs: ["`n`"],
      suggestions: [],
      docstring: { reflects: false, reason: DOC_LIE },
    },
    evidence: {
      "A função conta os itens com `len`.": [3],
      "A função imprime a contagem.": [4],
      "`itens`": [1],
      "`n`": [5],
      [DOC_SUGGESTION]: [3],
    },
  },
  {
    marker: "def total_fiel",
    draft: {
      summary:
        "A função conta os itens com `len`. A função imprime a contagem.",
      inputs: ["`itens`"],
      outputs: ["`n`"],
      suggestions: [],
      docstring: { reflects: true, reason: "A docstring descreve a contagem." },
    },
    evidence: {
      "A função conta os itens com `len`.": [3],
      "A função imprime a contagem.": [4],
      "`itens`": [1],
      "`n`": [5],
    },
  },
  {
    // Answers the docstring field although the request has no docstring.
    marker: "def total_sem_doc",
    draft: {
      summary:
        "A função conta os itens com `len`. A função imprime a contagem.",
      inputs: ["`itens`"],
      outputs: ["`n`"],
      suggestions: [],
      docstring: { reflects: false, reason: DOC_LIE },
    },
    evidence: {
      "A função conta os itens com `len`.": [2],
      "A função imprime a contagem.": [3],
      "`itens`": [1],
      "`n`": [4],
      [DOC_SUGGESTION]: [2],
    },
  },
  // Feature 05, the video code (pedido_video.py). They come first: the old marker
  // "def calcular_frete" also appears in the video code. Functions come before
  // steps, because a function's code holds its steps' markers.
  {
    // SPEC_DEVIATION: "def processar_pedido(req)", not "def processar_pedido" (D1).
    // Reason: pedido_frete.py also has "def processar_pedido(itens)", and its
    // existing E2E (CACHE-02) expects the fake to fail that node.
    marker: "def processar_pedido(req)",
    draft: {
      summary:
        "A função lê o pedido e calcula o frete. A função grava o pedido e envia um e-mail.",
      inputs: ["`req`"],
      outputs: ["total do pedido"],
      suggestions: PEDIDO_SUGGESTIONS,
    },
    evidence: {
      "A função lê o pedido e calcula o frete.": [2, 5],
      "A função grava o pedido e envia um e-mail.": [7, 8],
      "`req`": [1],
      "total do pedido": [9],
      [said(PEDIDO_SUGGESTIONS[0] as Suggestion)]: [7],
      [said(PEDIDO_SUGGESTIONS[1] as Suggestion)]: [8],
    },
  },
  {
    marker: "def calcular_frete(pedido, cep)",
    draft: {
      summary:
        "A função busca a UF com `requests.get`. A função escolhe a tabela pelo `peso`.",
      inputs: ["`pedido`", "`cep`"],
      outputs: ["valor do frete"],
      suggestions: [VIDEO_FRETE_SUGGESTION],
    },
    evidence: {
      "A função busca a UF com `requests.get`.": [2],
      "A função escolhe a tabela pelo `peso`.": [4, 5],
      "`pedido`": [1],
      "`cep`": [1],
      "valor do frete": [5, 7],
      [said(VIDEO_FRETE_SUGGESTION)]: [2],
    },
  },
  {
    // The HTTP step of calcular_frete (VID-28, Independent Test P2).
    marker: "viacep",
    draft: {
      summary:
        "A função consulta uma API externa com o CEP. A função retorna a UF.",
      inputs: ["`cep`"],
      outputs: ["`uf`"],
      suggestions: [],
    },
    evidence: {
      "A função consulta uma API externa com o CEP.": [1],
      "A função retorna a UF.": [1],
      "`cep`": [1],
      "`uf`": [1],
    },
  },
  {
    // The EXTERNO step: the 3rd sentence is cut before the review (VID-28).
    marker: "sum(item",
    draft: {
      summary:
        "Soma o peso dos itens. Guarda a soma em `peso`. Usa a função `sum`.",
      inputs: ["`pedido`"],
      outputs: ["`peso`"],
      suggestions: [],
    },
    evidence: {
      "Soma o peso dos itens.": [1],
      "Guarda a soma em `peso`.": [1],
      "Usa a função `sum`.": [1],
      "`pedido`": [1],
      "`peso`": [1],
    },
  },
  {
    // A RETORNO step with no input and no output (VID-30).
    marker: "return TABELA_PESADA",
    draft: {
      summary: "Retorna o valor da tabela pesada para a `uf`.",
      inputs: [],
      outputs: [],
      suggestions: [],
    },
    evidence: {
      "Retorna o valor da tabela pesada para a `uf`.": [1],
    },
  },
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
  {
    // CORE-22: the reviewer would accept both suggestions; only the line range
    // check drops the one on line 40 of a 3-line node.
    marker: "def media_notas",
    draft: {
      summary: "Divide a soma das notas pela quantidade.",
      inputs: ["`notas`"],
      outputs: ["média das notas"],
      suggestions: [
        {
          command: "Tratar a lista vazia",
          reason: "A divisão falha quando `notas` está vazia.",
          line: 3,
          severity: "alta",
        },
        {
          command: "Remover o laço repetido",
          reason: "O laço refaz a soma.",
          line: 40,
          severity: "baixa",
        },
      ],
    },
    evidence: {
      "Divide a soma das notas pela quantidade.": [2, 3],
      "`notas`": [1],
      "média das notas": [3],
      "Tratar a lista vazia A divisão falha quando `notas` está vazia.": [3],
      "Remover o laço repetido O laço refaz a soma.": [2],
    },
  },
];

/** Titles (VID-14): the first marker of this table found in a node block wins. */
const TITLES: [marker: string, title: string][] = [
  ["def processar_pedido", "Pedido recebido"],
  // The hub of its level: its block also holds "if peso > 30".
  ["def calcular_frete", "Calcular frete"],
  ["if peso > 30", "Peso acima de 30?"],
  ["json.loads", "Ler o pedido"],
  ["validar_pedido(pedido)", "Validar pedido"],
  ["db.buscar_cliente", "Buscar o cliente"],
  ["calcular_frete(pedido, cliente.cep)", "Calcular frete"],
  ["soma_itens(pedido)", "Somar os itens"],
  ["db.salvar", "Salvar no banco"],
  ["enviar_email", "Enviar e-mail"],
  ["viacep", "Buscar UF pelo CEP"],
  ["sum(item", "Somar peso"],
  ["return TABELA_PESADA", "Tabela pesada"],
  ["return TABELA_PADRAO", "Tabela padrão"],
  ["def aplicar_desconto", "Aplicar desconto no total"],
  // 7 words: layer one drops it before the reviewer (VID-14).
  ["def registrar_log", "Registrar a mensagem no log do sistema"],
  ["def contar", "Contar até zero"],
];
/** A block with this marker makes the whole title request fail (VID-15). */
const FAILING_TITLE = "def falha_titulo";
/** The title reviewer rejects this one (VID-16). */
const REJECTED_TITLE = "Aplicar desconto no total";

/** Blocks `[nX] ...` of the title request. */
function titleBlocks(user: string): { id: string; text: string }[] {
  return user.split(/\n(?=\[n\d+\] )/).flatMap((block) => {
    const m = /^\[(n\d+)\] /.exec(block);
    return m ? [{ id: m[1] as string, text: block }] : [];
  });
}

/** Title answer, or undefined (500) when a block asks for the failing title. */
function titles(user: string): string | undefined {
  const blocks = titleBlocks(user);
  if (blocks.some((b) => b.text.includes(FAILING_TITLE))) return undefined;
  return JSON.stringify({
    titles: blocks.flatMap(({ id, text }) => {
      const hit = TITLES.find(([marker]) => text.includes(marker));
      return hit ? [{ id, title: hit[1] }] : [];
    }),
  });
}

/** Each `- nX: <title>` is supported by line 1, except the rejected title. */
function titleVerdicts(user: string): string {
  const items = user.split("\n").flatMap((line) => {
    const m = /^- (n\d+): (.*)$/.exec(line);
    return m ? [{ id: m[1] as string, text: m[2] as string }] : [];
  });
  return JSON.stringify({
    verdicts: items.map(({ id, text }) =>
      text === REJECTED_TITLE
        ? {
            id,
            supported: false,
            evidence: [],
            problem: "o código não mostra o total com desconto",
          }
        : { id, supported: true, evidence: [1] },
    ),
  });
}

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

const CHAT_SUGGESTION = {
  command: "Defina um timeout na chamada HTTP.",
  reason: "Sem timeout a chamada pode travar.",
  line: 18,
  severity: "media",
};

/** The structuring answer: a suggestion when the text talks about a timeout, null otherwise. */
function structureReply(text: string): string {
  return JSON.stringify({
    suggestion: text.includes("timeout") ? CHAT_SUGGESTION : null,
  });
}

/** The chat answer, scripted by a word of the question; "falha" gets the 500 of an unscripted call. */
function chatReply(question: string): string | undefined {
  if (question.includes("falha")) return undefined;
  if (question.includes("formato")) {
    return JSON.stringify({
      reply:
        "Duas tarefas: - `fetch()` busca o **frete** (L18). - _calcula_ o total.",
      suggestion: null,
    });
  }
  // The chat answers in JSON; a "melhoria" question gets a suggestion with it.
  if (question.includes("melhoria")) {
    return JSON.stringify({
      reply: "Defina um timeout na chamada (L18).",
      suggestion: CHAT_SUGGESTION,
    });
  }
  if (question.includes("timeout"))
    return "Um timeout evita que a chamada trave (L18).";
  if (question.includes("longo")) return "palavra ".repeat(300);
  if (question.includes("linha")) return "A chamada de rede fica na linha L18.";
  return `Resposta sobre: ${question}`;
}

/** Scripted answer, or undefined for content the script does not know. */
function answer(call: FakeCall): string | undefined {
  const users = call.messages.filter((m) => m.role === "user");
  const last = users.at(-1)?.content ?? "";
  if (call.role === "chat") return chatReply(last);
  if (call.role === "structure") return structureReply(last);
  if (call.role === "title") return titles(last);
  if (call.role === "title-review") return titleVerdicts(last);
  const scenario = SCENARIOS.find((s) =>
    users.some((m) => m.content.includes(s.marker)),
  );
  if (!scenario) return undefined;
  // Each parser reads only its own fields of the same scripted draft.
  if (call.role === "draft" || call.role === "suggest") {
    return JSON.stringify(scenario.draft);
  }
  return verdicts(users.at(-1)?.content ?? "", scenario);
}

/**
 * The role comes from the system message, in this order (D1). A review of the
 * suggestions judges only suggestion items (`- g1: ...`); a summary review never does.
 */
function roleOf(
  system: string | undefined,
  user: string | undefined,
): FakeCall["role"] {
  const text = system ?? "";
  if (text.startsWith("Você conversa com quem revisa")) return "chat";
  if (text.startsWith("Você transforma uma resposta de conversa")) {
    return "structure";
  }
  if (text.startsWith("Você revisa títulos de nós")) return "title-review";
  if (text.startsWith("Você escreve títulos de nós")) return "title";
  if (text.includes('"verdicts"')) {
    return /^- g\d+: /m.test(user ?? "") ? "suggest-review" : "review";
  }
  if (text.startsWith("Você sugere melhorias")) return "suggest";
  return "draft";
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
    const call: FakeCall = {
      role: roleOf(
        body.messages.find((m) => m.role === "system")?.content,
        body.messages.filter((m) => m.role === "user").at(-1)?.content,
      ),
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
