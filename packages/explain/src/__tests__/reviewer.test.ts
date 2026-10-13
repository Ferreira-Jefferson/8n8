import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../prompt";
import {
  applyVerdicts,
  buildReviewerPrompt,
  parseVerdicts,
  redraftMessage,
  reviewerMessage,
  type Verdict,
} from "../reviewer";
import type { DraftClaim } from "../sentences";

const CODE = [
  "def calcular_frete(peso):",
  "    if peso > 30:",
  "        return 50",
  "    return 10",
].join("\n");

const claims: DraftClaim[] = [
  { id: "s1", text: "Calcula o frete a partir de `peso`.", kind: "sentence" },
  { id: "s2", text: "Devolve 50 quando `peso` passa de 30.", kind: "sentence" },
  { id: "i1", text: "`peso`", kind: "input" },
];

const ok = (id: string, evidence: number[]): Verdict => ({
  id,
  supported: true,
  evidence,
});

describe("buildReviewerPrompt (FID-05)", () => {
  it("asks for one verdict and evidence lines per item, only as JSON with verdicts", () => {
    const { text } = buildReviewerPrompt();
    expect(text).toContain('"verdicts"');
    expect(text).toContain('"supported"');
    expect(text).toContain('"evidence"');
    expect(text).toContain("linhas de evidência");
    expect(text).toContain("Responda só com JSON válido");
    expect(text).toContain("Julgue cada item só pelo código");
  });

  it("has a 12-hex version that is stable across calls", () => {
    const a = buildReviewerPrompt();
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(buildReviewerPrompt().version).toBe(a.version);
  });

  afterEach(() => {
    vi.doUnmock("../checks");
    vi.resetModules();
  });

  it("changes version when UNITS changes", async () => {
    const before = buildReviewerPrompt();
    vi.resetModules();
    vi.doMock("../checks", async (importOriginal) => {
      const real = await importOriginal<typeof import("../checks")>();
      return { ...real, UNITS: [...real.UNITS, "pol"] };
    });
    const changed = (await import("../reviewer")).buildReviewerPrompt();
    expect(changed.text).toBe(before.text);
    expect(changed.version).not.toBe(before.version);
  });
});

describe("reviewerMessage (FID-06)", () => {
  const msg = reviewerMessage(CODE, ["aplicar_taxa", "main"], claims);

  it("contains the code numbered 1..n, the neighbour names and the items as `- <id>: <text>`", () => {
    expect(msg).toContain("1 | def calcular_frete(peso):");
    expect(msg).toContain("4 |     return 10");
    expect(msg).not.toContain("5 |");
    expect(msg).toContain("aplicar_taxa");
    expect(msg).toContain("main");
    expect(msg).toContain("- s1: Calcula o frete a partir de `peso`.");
    expect(msg).toContain("- s2: Devolve 50 quando `peso` passa de 30.");
    expect(msg).toContain("- i1: `peso`");
  });

  it("does not carry the node label, the node name outside the code, the PTS text or the raw draft JSON", () => {
    expect(msg).not.toContain("Nó:");
    const outsideCode = msg
      .split("\n")
      .filter((line) => !/^\d+ \| /.test(line))
      .join("\n");
    expect(outsideCode).not.toContain("calcular_frete");
    const pts = buildSystemPrompt("REGRAS PTS").text;
    expect(msg).not.toContain("REGRAS PTS");
    expect(msg).not.toContain(pts.slice(0, 40));
    expect(msg).not.toContain('"summary"');
    expect(msg).not.toContain('"suggestions"');
  });
});

describe("parseVerdicts", () => {
  const body = JSON.stringify({
    verdicts: [
      ok("s1", [1]),
      { id: "s2", supported: false, evidence: [], problem: "x" },
    ],
  });

  it("parses plain JSON and JSON inside ``` fences", () => {
    const expected = [
      ok("s1", [1]),
      { id: "s2", supported: false, evidence: [], problem: "x" },
    ];
    expect(parseVerdicts(body)).toEqual(expected);
    expect(parseVerdicts(`\`\`\`json\n${body}\n\`\`\``)).toEqual(expected);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseVerdicts("isto não é JSON")).toThrow();
  });

  it("throws on JSON outside the schema", () => {
    expect(() => parseVerdicts(JSON.stringify({ itens: [] }))).toThrow();
    expect(() =>
      parseVerdicts(
        JSON.stringify({
          verdicts: [{ id: "s1", supported: "sim", evidence: [1] }],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseVerdicts(
        JSON.stringify({
          verdicts: [{ id: "s1", supported: true, evidence: [1.5] }],
        }),
      ),
    ).toThrow();
  });
});

describe("applyVerdicts (FID-07)", () => {
  it("keeps every supported item with evidence inside 1..lineCount", () => {
    const { kept, problems } = applyVerdicts(
      claims,
      [ok("s1", [1]), ok("s2", [2, 3]), ok("i1", [1])],
      4,
    );
    expect(problems).toEqual([]);
    expect(kept).toEqual([
      { ...claims[0], lines: [1] },
      { ...claims[1], lines: [2, 3] },
      { ...claims[2], lines: [1] },
    ]);
  });

  it("marks an item without verdict as unsupported and keeps the others", () => {
    const { kept, problems } = applyVerdicts(
      claims,
      [ok("s1", [1]), ok("i1", [1])],
      4,
    );
    expect(kept.map((c) => c.id)).toEqual(["s1", "i1"]);
    expect(problems).toEqual([
      { id: "s2", text: claims[1]?.text, problem: expect.any(String) },
    ]);
  });

  it("marks supported=false as unsupported, carrying the reviewer problem", () => {
    const { kept, problems } = applyVerdicts(
      claims,
      [
        ok("s1", [1]),
        { id: "s2", supported: false, evidence: [3], problem: "não há 50" },
        ok("i1", [1]),
      ],
      4,
    );
    expect(kept.map((c) => c.id)).toEqual(["s1", "i1"]);
    expect(problems).toEqual([
      { id: "s2", text: claims[1]?.text, problem: "não há 50" },
    ]);
  });

  it("marks empty evidence as unsupported", () => {
    const { kept, problems } = applyVerdicts(
      claims,
      [ok("s1", []), ok("s2", [2]), ok("i1", [1])],
      4,
    );
    expect(kept.map((c) => c.id)).toEqual(["s2", "i1"]);
    expect(problems.map((p) => p.id)).toEqual(["s1"]);
  });

  it("marks evidence with a line outside 1..lineCount as unsupported (0 and n+1)", () => {
    const { kept, problems } = applyVerdicts(
      claims,
      [ok("s1", [0, 1]), ok("s2", [2, 5]), ok("i1", [4])],
      4,
    );
    expect(kept).toEqual([{ ...claims[2], lines: [4] }]);
    expect(problems.map((p) => p.id)).toEqual(["s1", "s2"]);
  });

  it("sorts kept lines and drops repeats ([7,5,5] → [5,7])", () => {
    const { kept } = applyVerdicts(
      [claims[0] as DraftClaim],
      [ok("s1", [7, 5, 5])],
      9,
    );
    expect(kept[0]?.lines).toEqual([5, 7]);
  });
});

describe("redraftMessage (FID-08)", () => {
  it("lists each problem as `- <id> «text»: problem` between the fixed header and footer", () => {
    expect(
      redraftMessage([
        {
          id: "s2",
          text: "A caixa pesa 5 kg.",
          problem: "o número 5 não aparece no código",
        },
      ]),
    ).toBe(
      [
        "Problemas encontrados:",
        "- s2 «A caixa pesa 5 kg.»: o número 5 não aparece no código",
        "Reescreva o JSON inteiro sem essas afirmações.",
      ].join("\n"),
    );
  });
});
