import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { test as base } from "@playwright/test";
import { INSPECT_OFFSET, LANE_PORT, lanePort } from "./lane";

export * from "@playwright/test";

// The `test` of every spec. With E2E_COVERAGE=1 (pnpm e2e:map) each test records the
// functions that ran, in the page and in the servers, and the CSS rules the page used;
// scripts/e2e-map.mjs joins them into e2e/coverage-map.json. Without it, this is
// Playwright's own `test`. Not a spec: Playwright only runs *.e2e.ts.

const REPO = fileURLToPath(new URL("..", import.meta.url));
/** Where each worker appends one line per test; scripts/e2e-map.mjs reads it. */
export const COVERAGE_DIR = join(REPO, ".cache", "e2e-coverage");
const DIST = join(REPO, "apps", "cli", "dist");
const WEB = join(DIST, "web");

/**
 * Where Vite wrote a file the CLI copied to dist/web: the page's source maps point to
 * src/ from apps/ui/dist, not from the copy.
 */
const builtAt = (file: string) =>
  file.startsWith(WEB)
    ? join(REPO, "apps", "ui", "dist", relative(WEB, file))
    : file;

interface FunctionCoverage {
  functionName: string;
  ranges: { startOffset: number; endOffset: number; count: number }[];
}
interface ScriptCoverage {
  url: string;
  functions: FunctionCoverage[];
}
interface Bundle {
  lineStarts: number[];
  map: TraceMap;
}

const bundles = new Map<string, Bundle | null>();

/** The built file and its source map, or null when it has none. */
function bundleOf(file: string): Bundle | null {
  if (!bundles.has(file)) {
    const mapFile = `${file}.map`;
    if (!existsSync(file) || !existsSync(mapFile)) bundles.set(file, null);
    else {
      const code = readFileSync(file, "utf8");
      const lineStarts = [0];
      for (let i = 0; i < code.length; i++) {
        if (code[i] === "\n") lineStarts.push(i + 1);
      }
      const map = new TraceMap(
        readFileSync(mapFile, "utf8"),
        pathToFileURL(builtAt(mapFile)).href,
      );
      bundles.set(file, { lineStarts, map });
    }
  }
  return bundles.get(file) ?? null;
}

/** The built file behind a script URL: the page's under dist/web, the server's in dist. */
function fileOf(url: string): string | undefined {
  if (url.startsWith("file:")) return fileURLToPath(url);
  if (url.startsWith("http:")) return join(WEB, new URL(url).pathname);
  return undefined;
}

/** The source file and line of an offset of the bundle, outside node_modules. */
function sourceAt(bundle: Bundle, offset: number) {
  let line = 0;
  let high = bundle.lineStarts.length - 1;
  while (line < high) {
    const mid = (line + high + 1) >> 1;
    if ((bundle.lineStarts[mid] ?? 0) <= offset) line = mid;
    else high = mid - 1;
  }
  const at = originalPositionFor(bundle.map, {
    line: line + 1,
    column: offset - (bundle.lineStarts[line] ?? 0),
  });
  if (!at.source?.startsWith("file:") || at.line === null) return undefined;
  const path = relative(REPO, fileURLToPath(at.source)).replaceAll("\\", "/");
  if (path.includes("node_modules") || path.startsWith("..")) return undefined;
  return { path, line: at.line };
}

/**
 * The functions that ran, as `<file>:<first line>-<last line>` of the source. A function
 * whose end maps nowhere, or to another file, keeps its first line alone.
 */
function functionsRun(scripts: ScriptCoverage[], into: Set<string>): void {
  for (const script of scripts) {
    const file = fileOf(script.url);
    const bundle = file && bundleOf(file);
    if (!bundle) continue;
    for (const fn of script.functions) {
      const range = fn.ranges[0];
      // The module's own top level spans the whole bundle: it says nothing.
      if (!range || range.count === 0 || range.startOffset === 0) continue;
      const start = sourceAt(bundle, range.startOffset);
      if (!start) continue;
      const end = sourceAt(bundle, range.endOffset - 1);
      const last =
        end && end.path === start.path && end.line >= start.line
          ? end.line
          : start.line;
      into.add(`${start.path}:${start.line}-${last}`);
    }
  }
}

/** A selector with no spaces and one kind of quote, as minified and as written. */
const normalSelector = (selector: string) =>
  selector.replace(/\s+/g, "").replaceAll('"', "'");

/**
 * The selectors of the CSS rules the page used. Playwright joins the used rules that
 * sit side by side into one range, so a range holds many: each `{` closes a prelude.
 */
function selectorsUsed(
  sheets: { text?: string; ranges: { start: number; end: number }[] }[],
  into: Set<string>,
): void {
  for (const sheet of sheets) {
    for (const range of sheet.ranges) {
      let prelude = "";
      for (const c of (sheet.text ?? "").slice(range.start, range.end)) {
        if (c === "{") {
          const selector = prelude.trim();
          if (selector && !selector.startsWith("@")) {
            into.add(normalSelector(selector));
          }
          prelude = "";
        } else if (c === "}" || c === ";") prelude = "";
        else prelude += c;
      }
    }
  }
}

/** A connection to a server's inspector that takes its precise coverage. */
async function inspector(port: number) {
  const list = (await (
    await fetch(`http://127.0.0.1:${port}/json/list`)
  ).json()) as { webSocketDebuggerUrl: string }[];
  const ws = new WebSocket(list[0]?.webSocketDebuggerUrl ?? "");
  await new Promise((open, fail) => {
    ws.onopen = open;
    ws.onerror = fail;
  });
  let id = 0;
  const pending = new Map<number, (result: unknown) => void>();
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    pending.get(message.id)?.(message.result);
    pending.delete(message.id);
  };
  const send = <T>(method: string, params = {}) =>
    new Promise<T>((done) => {
      pending.set(++id, done as (result: unknown) => void);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Profiler.enable");
  await send("Profiler.startPreciseCoverage", { callCount: true });
  return {
    /** The coverage since the last take; taking resets the counts. */
    take: async () =>
      (await send<{ result: ScriptCoverage[] }>("Profiler.takePreciseCoverage"))
        .result,
    close: () => ws.close(),
  };
}

/** The servers of this worker's lane (playwright.config.ts), all but the fake LLM. */
const serverPorts = () =>
  Object.values(LANE_PORT)
    .filter((offset) => offset !== LANE_PORT.fake)
    .map((offset) => lanePort(offset));

type Inspector = Awaited<ReturnType<typeof inspector>>;

/** By default every spec reaches its lane's keyless server; test.use still changes it. */
const laned = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures from the pattern.
  baseURL: async ({}, use) =>
    use(`http://127.0.0.1:${lanePort(LANE_PORT.offline)}`),
});

const covered = laned.extend<
  { coverage: undefined },
  { inspectors: Inspector[] }
>({
  inspectors: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads the fixtures from the pattern.
    async ({}, use) => {
      const inspectors = await Promise.all(
        serverPorts().map((port) => inspector(port + INSPECT_OFFSET)),
      );
      await use(inspectors);
      for (const i of inspectors) i.close();
    },
    { scope: "worker" },
  ],
  coverage: [
    async ({ page, inspectors }, use, testInfo) => {
      await Promise.all(inspectors.map((i) => i.take()));
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await page.coverage.startCSSCoverage({ resetOnNavigation: false });
      await use(undefined);
      const functions = new Set<string>();
      const selectors = new Set<string>();
      functionsRun(await page.coverage.stopJSCoverage(), functions);
      selectorsUsed(await page.coverage.stopCSSCoverage(), selectors);
      for (const i of inspectors) functionsRun(await i.take(), functions);
      mkdirSync(COVERAGE_DIR, { recursive: true });
      appendFileSync(
        join(COVERAGE_DIR, `worker-${testInfo.parallelIndex}.jsonl`),
        `${JSON.stringify({
          spec: relative(REPO, testInfo.file).replaceAll("\\", "/"),
          functions: [...functions],
          selectors: [...selectors],
        })}\n`,
      );
    },
    { auto: true },
  ],
});

// The coverage fixture is automatic and no spec names it: the type stays Playwright's.
export const test = (process.env.E2E_COVERAGE ? covered : laned) as typeof base;
