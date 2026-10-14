import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type FakeCall, fakeLog, resetFake } from "./fake-llm";
import {
  FRETE_LEVEL,
  freshReal,
  MAIN_FLOW,
  OFFLINE,
  PEDIDO,
  REAL,
  VIDEO,
} from "./mapa";

// Measurements, not checks (no spec thresholds). Run them apart from the suite:
//   CODE2N8N_PERF=1 pnpm exec playwright test --project performance
// Each prints a table. The only assertions are loose sanity bounds (30 s), so
// the file never flakes on a slow machine.

const RUNS = 5;
const SANITY_MS = 30_000;

type Row = Record<string, string | number>;
const rows: Row[] = [];

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

test.afterAll(() => {
  console.log("\n=== Performance results ===");
  console.table(rows);
});

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)] ?? Number.NaN;
  return {
    median: Math.round(median),
    min: Math.round(s[0] ?? Number.NaN),
    max: Math.round(s.at(-1) ?? Number.NaN),
  };
}

function record(measure: string, server: string, values: number[], extra = "") {
  for (const v of values) expect(v).toBeLessThan(SANITY_MS);
  rows.push({
    measure,
    server,
    runs: values.length,
    ...stats(values),
    unit: "ms",
    note: extra,
  });
}

const serverName = (base: string) =>
  base === OFFLINE ? "4317 offline" : "4319 fake LLM";

/**
 * Milliseconds from a click (run in the page) until `ids` are drawn, and until
 * they are settled. Null when the level stays blank (the canvas bug).
 */
async function timeClick(
  page: Page,
  click: string,
  ids: string[],
): Promise<{ drawn: number; settled: number } | null> {
  const t0 = await page.evaluate((code) => {
    const t = performance.now();
    new Function(code)();
    return t;
  }, click);
  try {
    const d = await page.waitForFunction(
      (list) =>
        list.every((id: string) => {
          const el = document.querySelector(
            `[aria-roledescription="node"][data-id="${id}"]`,
          );
          return el !== null && getComputedStyle(el).visibility === "visible";
        })
          ? performance.now()
          : 0,
      ids,
      { polling: "raf", timeout: 8000 },
    );
    const drawnAt = (await d.jsonValue()) as number;
    const s = await page.waitForFunction(
      (list) =>
        list.every((id: string) => {
          const el = document.querySelector(
            `[aria-roledescription="node"][data-id="${id}"]`,
          );
          const card = el?.querySelector(".node");
          return (
            el !== null &&
            card &&
            getComputedStyle(el).visibility === "visible" &&
            getComputedStyle(card).opacity === "1"
          );
        })
          ? performance.now()
          : 0,
      ids,
      { polling: "raf", timeout: 15_000 },
    );
    const settledAt = (await s.jsonValue()) as number;
    return { drawn: drawnAt - t0, settled: settledAt - t0 };
  } catch {
    return null;
  }
}

const CLICK_GENERATE = `[...document.querySelectorAll("button")].find((b) => b.textContent === "Gerar mapa").click();`;
const clickCardCode = (id: string) =>
  `document.querySelector('[aria-roledescription="node"][data-id="${id}"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));`;
const CLICK_BACK = `[...document.querySelectorAll("button")].find((b) => b.textContent === "Voltar").click();`;

/** Counts the page's /api/ requests in flight. */
function trackApi(page: Page, counts?: Record<string, number>): () => number {
  let inFlight = 0;
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (!path.startsWith("/api/")) return;
    inFlight++;
    if (counts) counts[path] = (counts[path] ?? 0) + 1;
  });
  const done = (r: { url(): string }) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) inFlight--;
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return () => inFlight;
}

/** Waits until no /api/ request is in flight for `quietMs`. */
async function quiet(page: Page, inFlight: () => number, quietMs = 400) {
  let calm = 0;
  while (calm < quietMs) {
    await page.waitForTimeout(50);
    calm = inFlight() === 0 ? calm + 50 : 0;
  }
}

async function toEditor(page: Page, base: string, source: string) {
  await page.goto(`${base}/`);
  await page.getByLabel("Trecho Python").fill(source);
}

for (const base of [OFFLINE, REAL]) {
  for (const reduced of [false, true]) {
    test(`(a, b, c) video map, open and back on ${serverName(base)}${reduced ? ", reduced motion" : ""}`, async ({
      page,
    }) => {
      if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
      const inFlight = trackApi(page);
      const gen = { drawn: [] as number[], settled: [] as number[] };
      const open: number[] = [];
      const back: number[] = [];
      const blank = { top: 0, open: 0, back: 0, early: 0 };
      const early: number[] = [];
      for (let i = 0; i < RUNS; i++) {
        // A fresh cache each run on the keyed server: titles are asked every time.
        if (base === REAL) await freshReal();
        await toEditor(page, base, VIDEO);
        const g = await timeClick(page, CLICK_GENERATE, MAIN_FLOW);
        if (!g) {
          blank.top++;
          continue;
        }
        gen.drawn.push(g.drawn);
        gen.settled.push(g.settled);
        // Open after the level's titles came, as a reader would.
        await quiet(page, inFlight);
        const o = await timeClick(
          page,
          clickCardCode(`${PEDIDO}/s3`),
          FRETE_LEVEL,
        );
        if (!o) {
          blank.open++;
          continue;
        }
        open.push(o.drawn);
        await quiet(page, inFlight);
        const b = await timeClick(page, CLICK_BACK, MAIN_FLOW);
        if (!b) {
          blank.back++;
          continue;
        }
        back.push(b.drawn);
      }
      // Open at once, while the titles of the main flow are still on the way.
      for (let i = 0; i < RUNS; i++) {
        if (base === REAL) await freshReal();
        await toEditor(page, base, VIDEO);
        if (!(await timeClick(page, CLICK_GENERATE, MAIN_FLOW))) continue;
        const o = await timeClick(
          page,
          clickCardCode(`${PEDIDO}/s3`),
          FRETE_LEVEL,
        );
        if (o) early.push(o.drawn);
        else blank.early++;
      }
      const label = `${serverName(base)}${reduced ? ", reduced" : ""}`;
      const blanks = (n: number) => (n ? `${n} of ${RUNS} blank` : "");
      record(
        "(a) Gerar mapa → 8 cards drawn",
        label,
        gen.drawn,
        blanks(blank.top),
      );
      record(
        "(a) Gerar mapa → 8 cards settled (opacity 1)",
        label,
        gen.settled,
      );
      record(
        "(b) click Calcular frete → 5 inner cards drawn",
        label,
        open,
        blanks(blank.open),
      );
      record("(c) Voltar → main flow drawn", label, back, blanks(blank.back));
      record(
        "(b') click Calcular frete at once after Gerar mapa",
        label,
        early,
        blanks(blank.early),
      );
    });
  }
}

/** A project of `files` .py files, 5 functions each; each calls the next one, across files. */
function syntheticProject(dir: string, files: number): string {
  mkdirSync(dir, { recursive: true });
  for (let f = 0; f < files; f++) {
    const next = (f + 1) % files;
    const lines = [`from m${next} import f${next}_0`, ""];
    for (let k = 0; k < 5; k++) {
      lines.push("", `def f${f}_${k}(x):`);
      lines.push(
        k < 4 ? `    return f${f}_${k + 1}(x) + 1` : `    return f${next}_0(x)`,
      );
    }
    writeFileSync(join(dir, `m${f}.py`), `${lines.join("\n")}\n`);
  }
  return dir;
}

/** The same functions as one snippet, for /api/graph. */
function syntheticSnippet(files: number): string {
  const lines: string[] = [];
  for (let f = 0; f < files; f++) {
    const next = (f + 1) % files;
    for (let k = 0; k < 5; k++) {
      lines.push(`def f${f}_${k}(x):`);
      lines.push(
        k < 4 ? `    return f${f}_${k + 1}(x) + 1` : `    return f${next}_0(x)`,
        "",
        "",
      );
    }
  }
  return lines.join("\n");
}

for (const files of [50, 300]) {
  test(`(d) /api/graph and /api/project latency, ${files} files × 5 functions`, async ({
    request,
  }, testInfo) => {
    const dir = syntheticProject(testInfo.outputPath(`proj-${files}`), files);
    const source = syntheticSnippet(files);
    for (const base of [OFFLINE, REAL]) {
      const graph: number[] = [];
      const project: number[] = [];
      let nodes = 0;
      for (let i = 0; i < RUNS; i++) {
        let t = performance.now();
        const g = await request.post(`${base}/api/graph`, { data: { source } });
        graph.push(performance.now() - t);
        expect(g.ok()).toBe(true);
        t = performance.now();
        const p = await request.post(`${base}/api/project`, {
          data: { path: dir },
        });
        project.push(performance.now() - t);
        expect(p.ok()).toBe(true);
        nodes = ((await p.json()) as { graph: { nodes: unknown[] } }).graph
          .nodes.length;
      }
      record(
        `(d) /api/graph, ${files * 5} functions in one snippet (${Math.round(source.length / 1024)} KB)`,
        serverName(base),
        graph,
      );
      record(
        `(d) /api/project, ${files} files`,
        serverName(base),
        project,
        `${nodes} nodes`,
      );
    }
  });
}

/** A main flow with 40 calls: one entry, 40 external calls (VID-10). */
const FORTY = `def principal(pedido):\n${Array.from(
  { length: 40 },
  (_, i) => `    servico.passo_${i}(pedido)`,
).join("\n")}\n`;
const FORTY_IDS = [
  "fn:principal",
  ...Array.from({ length: 40 }, (_, i) => `fn:principal/s${i}`),
];

for (const base of [OFFLINE, REAL]) {
  test(`(e) main flow with 40 calls on ${serverName(base)}`, async ({
    page,
  }) => {
    const drawnMs: number[] = [];
    const settledMs: number[] = [];
    let blank = 0;
    for (let i = 0; i < RUNS; i++) {
      if (base === REAL) await freshReal();
      await toEditor(page, base, FORTY);
      const r = await timeClick(page, CLICK_GENERATE, FORTY_IDS);
      if (!r) {
        blank++;
        continue;
      }
      drawnMs.push(r.drawn);
      settledMs.push(r.settled);
    }
    const note = blank ? `${blank} blank level(s) skipped` : "";
    record("(e) 41 cards drawn", serverName(base), drawnMs, note);
    record("(e) 41 cards settled (opacity 1)", serverName(base), settledMs);
  });
}

test("(f) title and LLM calls when walking the whole video map, then again from the cache", async ({
  page,
}) => {
  await freshReal();
  const api: Record<string, number> = {};
  const inFlight = trackApi(page, api);

  const ids = () =>
    page
      .locator('[aria-roledescription="node"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? ""));
  const marks = () =>
    page
      .locator('[aria-roledescription="node"]')
      .evaluateAll((els) =>
        els.map((el) => el.querySelector(".open-mark") !== null),
      );
  // Clicks by dispatch: the walk counts requests, so a level left blank by the
  // canvas bug must not stop it.
  const click = (id: string) =>
    page
      .locator(`[aria-roledescription="node"][data-id="${id}"]`)
      .dispatchEvent("click");

  async function walk(depth: number): Promise<number> {
    let opened = 0;
    const level = await ids();
    const open = await marks();
    for (const [i, id] of level.entries()) {
      await click(id);
      if (open[i]) {
        opened++;
        await expect.poll(ids).not.toEqual(level);
        await quiet(page, inFlight);
        opened += await walk(depth + 1);
        await page.keyboard.press("Escape");
        await expect.poll(ids).toEqual(level);
      }
      await quiet(page, inFlight);
    }
    return opened;
  }

  const results: Row[] = [];
  for (const pass of ["first walk, empty cache", "second walk, cache"]) {
    await resetFake();
    for (const k of Object.keys(api)) delete api[k];
    await toEditor(page, REAL, VIDEO);
    await page.getByRole("button", { name: "Gerar mapa" }).click();
    await expect.poll(ids).toEqual(MAIN_FLOW);
    await quiet(page, inFlight);
    const opened = await walk(0);
    const log: FakeCall[] = await fakeLog();
    const by = (role: string) => log.filter((c) => c.role === role).length;
    results.push({
      pass,
      levelsOpened: opened,
      "/api/titles": api["/api/titles"] ?? 0,
      "/api/explain": api["/api/explain"] ?? 0,
      "LLM total": log.length,
      title: by("title"),
      "title-review": by("title-review"),
      draft: by("draft"),
      review: by("review"),
    });
  }
  console.log("\n=== (f) Walk of the video map on 4319 (fake LLM) ===");
  console.table(results);
  // Sanity only: the cache makes the second walk cheaper. A node with no
  // approved title, or whose summary failed, is asked again by design.
  expect(results[1]?.["LLM total"]).toBeLessThan(
    results[0]?.["LLM total"] as number,
  );
  expect(results[1]?.["title-review"]).toBe(0);
});
