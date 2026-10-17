import type { FlowNode, LinkChannel, LinkRequest, Offer } from "@8n8/model";
import { describe, expect, it } from "vitest";
import { linkProject } from "../link";
import { fileNode, innerNode, nodeId } from "./helpers";
import { linkProjectReference } from "./reference-link";

/** A small seeded generator, so a failure repeats. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FILES = [
  "a.py",
  "b.py",
  "app/c.py",
  "x.ts",
  "api/y.ts",
  "api/z.tsx",
  "tools/run.ts",
  "tools/run.py",
  "README",
];
const NAMES = ["f", "g", "h", "i", "j"];
const HTTP_KEYS = [
  "GET /api/a",
  "POST /api/a",
  "GET /api/:id",
  "POST /api/{id}/b",
  "/api/a",
  "http://localhost:3000/api/a",
  "GET /api/a/b",
  "* /api/a",
  "GET /",
  "PUT /x?y=1",
];
const PROCESS_OFFER_KEYS = [
  "tools/run.ts",
  "tools/run.py",
  "api/y.ts",
  "./x.ts",
  "tools/../a.py",
  ".",
  "../out.ts",
];
const PROCESS_REQUEST_KEYS = [
  "node tools/run.ts",
  "python run.py --x",
  '["node", "./x.ts"]',
  "node ../tools/run.ts",
  "ts-node api/y.ts a.py",
  "echo hello",
  "tools/run.py",
];
const NAME_KEYS = ["f", "g", "h", "calcular", "somar"];

const KEYS: Record<LinkChannel, [string[], string[]]> = {
  http: [HTTP_KEYS, HTTP_KEYS],
  process: [PROCESS_OFFER_KEYS, PROCESS_REQUEST_KEYS],
  name: [NAME_KEYS, NAME_KEYS],
};

function scenario(seed: number) {
  const next = random(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(next() * list.length)] as T;
  const channels: LinkChannel[] = ["http", "process", "name"];
  const nodes: FlowNode[] = FILES.flatMap((path) => [
    fileNode(path),
    ...NAMES.map((name) => innerNode(path, name)),
  ]);
  const make = (kind: 0 | 1, count: number) =>
    Array.from({ length: count }, (): Offer | LinkRequest => {
      const channel = pick(channels);
      return {
        channel,
        key: pick(KEYS[channel][kind]),
        nodeId: nodeId(pick(FILES), pick(NAMES)),
        line: 1 + Math.floor(next() * 5),
      };
    });
  return {
    nodes,
    offers: make(0, 5 + Math.floor(next() * 30)) as Offer[],
    requests: make(1, 5 + Math.floor(next() * 30)) as LinkRequest[],
  };
}

describe("linkProject with the offers indexed by key", () => {
  it("gives the same answer as trying every offer for every request: same wires, order, unlinked and ambiguous", () => {
    let linked = 0;
    let ambiguous = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const input = scenario(seed);
      const real = linkProject(input);
      const reference = linkProjectReference(input);
      expect(JSON.stringify(real), `seed ${seed}`).toBe(
        JSON.stringify(reference),
      );
      linked += real.edges.length;
      ambiguous += real.ambiguous.length;
    }
    // The generator reaches every kind of answer.
    expect(linked).toBeGreaterThan(100);
    expect(ambiguous).toBeGreaterThan(20);
  });
});
