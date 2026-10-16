// Verifica só o que a mudança afeta. Uso: pnpm verify [--base <ref>] [--commit <ref>] [--plan]
//
// A mudança são os arquivos alterados, staged ou não, e os novos, contra o HEAD (ou
// contra --base). Com --commit, são os arquivos daquele commit: serve para ver, com
// --plan, o que um commit antigo teria rodado. Para cada arquivo:
// - unitários: `vitest related` no pacote do arquivo e nos que dependem dele;
// - typecheck: os mesmos pacotes, e o e2e quando ele pode ter mudado;
// - e2e: os specs que executaram a função onde cada linha alterada cai, ou que usaram a
//   regra de CSS alterada, pelo mapa de cobertura (e2e/coverage-map.json, refeito com
//   pnpm e2e:map).
// O que o mapa não explica roda tudo, nunca nada. A suíte inteira roda no CI.
// --plan só mostra o que rodaria.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const base = args.includes("--base")
  ? args[args.indexOf("--base") + 1]
  : "HEAD";
const commitRef = args.includes("--commit")
  ? args[args.indexOf("--commit") + 1]
  : undefined;
const onlyPlan = args.includes("--plan");
const shell = process.platform === "win32";
const git = (...a) =>
  execFileSync("git", a, { cwd: root }).toString().split("\n").filter(Boolean);

const changed = [
  ...new Set(
    commitRef
      ? git("diff-tree", "--no-commit-id", "--name-only", "-r", commitRef)
      : [
          ...git("diff", "--name-only", base),
          ...git("ls-files", "--others", "--exclude-standard"),
        ],
  ),
].filter((f) => !f.startsWith(".claude/"));

// --- Pacotes do workspace e quem depende de quem ------------------------------
const packages = JSON.parse(
  execFileSync("pnpm", ["-r", "ls", "--depth", "-1", "--json"], {
    cwd: root,
    shell,
  }).toString(),
)
  .filter((p) => p.path !== root)
  .map((p) => {
    const manifest = JSON.parse(
      readFileSync(join(p.path, "package.json"), "utf8"),
    );
    return {
      name: p.name,
      dir: relative(root, p.path).replaceAll("\\", "/"),
      scripts: manifest.scripts ?? {},
      deps: Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
      }),
    };
  });
const packageOf = (file) =>
  packages
    .filter((p) => file.startsWith(`${p.dir}/`))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
/** O pacote e todos os que dependem dele, direta ou indiretamente. */
function withDependents(name, into = new Set()) {
  if (into.has(name)) return into;
  into.add(name);
  for (const p of packages)
    if (p.deps.includes(name)) withDependents(p.name, into);
  return into;
}

// --- O mapa de cobertura dos e2e ------------------------------------------------
// Versionado: chega com o git pull, sem ferramenta nenhuma. Quem quiser o refaz com
// pnpm e2e:map; o verify só avisa quando ele fica velho.
const mapFile = join(root, "e2e", "coverage-map.json");
const map = existsSync(mapFile)
  ? JSON.parse(readFileSync(mapFile, "utf8"))
  : { specs: {}, loaded: [] };
/** Commits desde o mapa a partir dos quais o verify sugere refazê-lo. */
const STALE_AFTER = 30;
function mapNoteOf() {
  if (!map.commit) return "sem mapa: todos os e2e rodam. Gere com pnpm e2e:map";
  try {
    const behind = Number(
      execFileSync("git", ["rev-list", "--count", `${map.commit}..HEAD`], {
        cwd: root,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString(),
    );
    return behind >= STALE_AFTER
      ? `o mapa tem ${behind} commits: refaça com pnpm e2e:map`
      : "";
  } catch {
    return `o commit do mapa (${map.commit}) não está neste histórico: refaça com pnpm e2e:map`;
  }
}
const mapNote = mapNoteOf();
const allSpecs = readdirSync(join(root, "e2e"))
  .filter((f) => f.endsWith(".e2e.ts") && f !== "performance.e2e.ts")
  .map((f) => `e2e/${f}`);
const loaded = new Set(map.loaded);
const screenshotSpecs = allSpecs.filter((s) =>
  readFileSync(join(root, s), "utf8").includes("toHaveScreenshot"),
);

/** Arquivo → funções que algum spec executou: linhas e os specs que as executaram. */
const functionsByFile = new Map();
(map.functions ?? []).forEach((id, index) => {
  const [, file, start, end] = id.match(/^(.*):(\d+)-(\d+)$/);
  const list = functionsByFile.get(file) ?? [];
  list.push({ start: Number(start), end: Number(end), index, specs: [] });
  functionsByFile.set(file, list);
});
const functionAt = new Map(
  [...functionsByFile.values()].flat().map((f) => [f.index, f]),
);
/** Seletor normalizado (inteiro e cada parte da lista) → specs que usaram a regra. */
const specsBySelector = new Map();
const normalSelector = (s) => s.replace(/\s+/g, "").replaceAll('"', "'");
/** As partes de uma lista de seletores, sem quebrar a vírgula de um :is(a, b). */
function selectorParts(selector) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const c of selector) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  return [...parts, current];
}
for (const [spec, run] of Object.entries(map.specs)) {
  for (const i of run.functions ?? []) functionAt.get(i)?.specs.push(spec);
  for (const i of run.selectors ?? []) {
    const selector = map.selectors[i];
    for (const key of new Set([selector, ...selectorParts(selector)])) {
      const specs = specsBySelector.get(key) ?? new Set();
      specs.add(spec);
      specsBySelector.set(key, specs);
    }
  }
}
const specsOfFile = (file) =>
  new Set((functionsByFile.get(file) ?? []).flatMap((f) => f.specs));

// --- As linhas que mudaram ----------------------------------------------------------
// As linhas do mapa são as do commit em que ele foi feito: compara com ele quando ele
// existe aqui. O que mudou depois dele e já foi commitado também entra, a mais.
const gitOk = (...a) => {
  try {
    execFileSync("git", a, { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const mapRef =
  map.commit &&
  base === "HEAD" &&
  gitOk("merge-base", "--is-ancestor", map.commit, "HEAD")
    ? map.commit
    : base;
const [oldRef, newRef] = commitRef ? [`${commitRef}^`, commitRef] : [mapRef];
/** O arquivo existe na versão (ou no disco, sem versão). */
const exists = (ref, file) =>
  ref
    ? gitOk("cat-file", "-e", `${ref}:${file}`)
    : existsSync(join(root, file));
const textAt = (ref, file) =>
  !exists(ref, file)
    ? ""
    : ref
      ? execFileSync("git", ["show", `${ref}:${file}`], {
          cwd: root,
        }).toString()
      : readFileSync(join(root, file), "utf8");

/** Os trechos alterados de um arquivo: linhas do lado antigo e do lado novo. */
function hunks(file) {
  const out = git(
    "diff",
    "-U0",
    oldRef,
    ...(newRef ? [newRef] : []),
    "--",
    file,
  );
  const ranges = [];
  for (const line of out) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    // Um trecho de 0 linhas é uma inserção depois da linha dada: vale a linha e a seguinte.
    const side = (from, count) =>
      count === 0 ? [Math.max(from, 1), from + 1] : [from, from + count - 1];
    ranges.push({
      old: side(Number(m[1]), m[2] === undefined ? 1 : Number(m[2])),
      new: side(Number(m[3]), m[4] === undefined ? 1 : Number(m[4])),
    });
  }
  return ranges;
}

/**
 * Specs de um arquivo de código pela função onde cada linha alterada cai. Uma linha fora
 * de toda função executada (import, constante, tipo, função que nenhum teste roda) vale
 * para o arquivo inteiro: os specs que executaram qualquer função dele.
 */
function specsForCode(file, why) {
  const fns = functionsByFile.get(file) ?? [];
  let wholeFile = false;
  const found = new Map();
  for (const { old } of hunks(file)) {
    for (let line = old[0]; line <= old[1]; line++) {
      const inner = fns
        .filter((f) => f.start <= line && line <= f.end)
        .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
      if (!inner) wholeFile = true;
      else for (const s of inner.specs) found.set(s, `${why}:${inner.start}`);
    }
  }
  if (wholeFile)
    for (const s of specsOfFile(file)) found.set(s, `${why} (fora de função)`);
  return found;
}

/** As regras de um CSS sem aninhamento: seletor ou at-rule e as linhas do bloco. */
function cssRules(text) {
  const rules = [];
  const stack = [];
  let line = 1;
  let prelude = "";
  let preludeLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const skipped = text.slice(i, end === -1 ? text.length : end + 2);
      line += skipped.split("\n").length - 1;
      i += skipped.length - 1;
      continue;
    }
    if (c === "\n") line++;
    if (c === "{") {
      stack.push({
        prelude: prelude.trim(),
        start: preludeLine,
        parent: stack.at(-1),
      });
      prelude = "";
    } else if (c === "}") {
      const rule = stack.pop();
      if (rule) rules.push({ ...rule, end: line });
      prelude = "";
    } else if (c === ";") prelude = "";
    else {
      if (!prelude.trim()) preludeLine = line;
      prelude += c;
    }
  }
  return rules;
}

/**
 * Specs de um CSS pelo seletor da regra onde cada linha alterada cai, no lado antigo e no
 * novo. Uma regra que nenhum spec usou, com classes, vale pelos specs que usaram outra
 * regra com as mesmas classes. Sem classe, ou numa at-rule que não é @media, roda tudo.
 */
function specsForCss(file) {
  const found = new Map();
  const sides = [
    ["old", cssRules(textAt(oldRef, file))],
    ["new", cssRules(textAt(newRef, file))],
  ];
  const affected = [];
  for (const range of hunks(file)) {
    for (const [side, rules] of sides) {
      const [from, to] = range[side];
      for (let line = from; line <= to; line++) {
        const inner = rules
          .filter((r) => r.start <= line && line <= r.end)
          .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
        if (!inner) continue;
        if (inner.prelude.startsWith("@media")) {
          affected.push(
            ...rules.filter((r) => r.parent?.start === inner.start),
          );
        } else affected.push(inner);
      }
    }
  }
  for (const rule of new Set(affected)) {
    const at =
      rule.prelude.startsWith("@") ||
      rule.parent?.prelude.startsWith("@keyframes");
    if (at) return { all: `${file}: ${rule.prelude}` };
    const selector = normalSelector(rule.prelude);
    const specs = new Set(
      [selector, ...selectorParts(selector)].flatMap((k) => [
        ...(specsBySelector.get(k) ?? []),
      ]),
    );
    if (!specs.size) {
      const classes = selector.match(/\.[\w-]+/g) ?? [];
      if (!classes.length) return { all: `${file}: ${rule.prelude}` };
      for (const [key, users] of specsBySelector) {
        if (classes.some((c) => new RegExp(`\\${c}(?![\\w-])`).test(key))) {
          for (const s of users) specs.add(s);
        }
      }
    }
    for (const s of specs)
      found.set(s, `${file}: ${rule.prelude.slice(0, 40)}`);
  }
  return { found };
}

// --- Classifica cada arquivo ----------------------------------------------------
const NOTHING = [
  /^docs\/(?!writing-rules\/)/,
  /^\.specs\//,
  /^\.github\//,
  /^[^/]+\.md$/,
  /^(LICENSE|SECURITY\.md|\.gitignore|\.gitleaks\.toml)$/,
  /^\.githooks\//,
  /^scripts\//,
  /^e2e\/coverage-map\.json$/,
];
/** Entram em todo build ou em toda execução: tudo roda. */
const EVERYTHING = [
  /(^|\/)package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /(^|\/)tsconfig[^/]*\.json$/,
  /(^|\/)vite(st)?\.config\.ts$/,
  /^playwright\.config\.ts$/,
  /^apps\/cli\/src\/build\.ts$/,
  /^apps\/ui\/(index\.html|public\/)/,
  /^docs\/writing-rules\//,
];
const CHECK_ONLY = [/^biome\.json$/, /^\.dependency-cruiser\.cjs$/];

const e2e = new Map(); // spec → motivo
let e2eAll = "";
let unitAll = "";
const unitFiles = new Set();
const unitPackages = new Set();
/** Pacotes cujos unitários rodam inteiros, não só os ligados aos arquivos. */
const wholePackages = new Set();
let e2eTypes = false;

const addSpec = (spec, why) => {
  if (!e2e.has(spec)) e2e.set(spec, why);
};
for (const file of changed) {
  if (
    NOTHING.some((r) => r.test(file)) ||
    CHECK_ONLY.some((r) => r.test(file))
  ) {
    continue;
  }
  if (EVERYTHING.some((r) => r.test(file))) {
    e2eAll ||= file;
    if (!/^playwright\.config\.ts$|^docs\//.test(file)) unitAll ||= file;
    e2eTypes = true;
    continue;
  }
  if (file.startsWith("e2e/")) {
    e2eTypes = true;
    if (file.endsWith(".e2e.ts")) {
      if (existsSync(join(root, file))) addSpec(file, "o spec mudou");
    } else if (file.startsWith("e2e/__baselines__/")) {
      for (const s of screenshotSpecs)
        addSpec(s, `imagem de referência: ${file}`);
    } else e2eAll ||= file;
    continue;
  }
  const pkg = packageOf(file);
  if (pkg) {
    unitFiles.add(file);
    for (const name of withDependents(pkg.name)) unitPackages.add(name);
    if (pkg.name === "@8n8/model") e2eTypes = true;
    // O teste que lê o CSS o importa com ?raw: o vitest related não o enxerga.
    if (file.endsWith(".css")) wholePackages.add(pkg.name);
  }
  if (/(^|\/)__tests__\//.test(file) || /\.test\.tsx?$/.test(file)) continue;
  if (file.startsWith("apps/editors/")) continue;
  if (file.startsWith("apps/cli/")) addSpec("e2e/cli.e2e.ts", file);
  if (file.startsWith("apps/ui/src/") && file.endsWith(".css")) {
    const { all, found } = specsForCss(file);
    if (all) e2eAll ||= all;
    else for (const [s, why] of found) addSpec(s, why);
    continue;
  }
  // Arquivo novo: só roda se um arquivo que já existia o importa, e esse arquivo mudou.
  if (!exists(oldRef, file)) continue;
  if (functionsByFile.has(file)) {
    for (const [s, why] of specsForCode(file, file)) addSpec(s, why);
  } else if (loaded.has(file)) {
    e2eAll ||= `${file} (roda ao carregar, em todo teste)`;
  } else if (!pkg) e2eAll ||= `${file} (arquivo sem regra)`;
  // Um arquivo de pacote que nenhum bundle carrega não chega aos e2e.
}
// Spec que o mapa ainda não conhece: roda sempre, até o mapa ser refeito.
for (const s of allSpecs) {
  if (!map.specs[s] && (e2e.size || e2eAll || unitFiles.size)) {
    addSpec(s, "spec fora do mapa");
  }
}

// --- O plano ---------------------------------------------------------------
const tests = packages.filter(
  (p) => p.scripts.test && (unitAll || unitPackages.has(p.name)),
);
const types = packages.filter(
  (p) => p.scripts.typecheck && (unitAll || unitPackages.has(p.name)),
);
const specs = e2eAll ? allSpecs : [...e2e.keys()].sort();

console.log(
  `verify: ${changed.length} arquivos mudados ${commitRef ? `no commit ${commitRef}` : `contra ${base}`}`,
);
if (map.commit) console.log(`  mapa e2e do commit ${map.commit}`);
if (mapNote) console.log(`  ${mapNote}`);
console.log(
  `  unitários: ${unitAll ? `todos (${unitAll})` : tests.map((p) => p.name).join(", ") || "nenhum"}`,
);
console.log(
  `  typecheck: ${types.map((p) => p.name).join(", ") || "nenhum"}${e2eTypes ? " + e2e" : ""}`,
);
if (e2eAll) console.log(`  e2e: todos os ${allSpecs.length} specs (${e2eAll})`);
else {
  console.log(`  e2e: ${specs.length} de ${allSpecs.length} specs`);
  for (const s of specs) console.log(`    ${s}  ← ${e2e.get(s)}`);
}
if (onlyPlan) process.exit(0);

// --- A execução -----------------------------------------------------------------
const run = (cmd, cmdArgs, cwd = ".") =>
  new Promise((done) => {
    const child = spawn(cmd, cmdArgs, { cwd: join(root, cwd), shell });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("exit", (code) =>
      done({ code, output, label: `${cwd} ${cmd} ${cmdArgs.join(" ")}` }),
    );
  });
async function pool(jobs, size) {
  const results = [];
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length) results.push(await queue.shift()());
    }),
  );
  return results;
}

const absolute = [...unitFiles].map((f) => join(root, f));
const jobs = [
  () => run("pnpm", ["check"]),
  ...tests.map(
    (p) => () =>
      unitAll || wholePackages.has(p.name)
        ? run("pnpm", ["exec", "vitest", "run"], p.dir)
        : run(
            "pnpm",
            [
              "exec",
              "vitest",
              "related",
              "--run",
              "--passWithNoTests",
              ...absolute,
            ],
            p.dir,
          ),
  ),
  ...types.map((p) => () => run("pnpm", ["exec", "tsc", "--noEmit"], p.dir)),
  ...(e2eTypes ? [() => run("pnpm", ["exec", "tsc", "-p", "e2e"])] : []),
];
const started = Date.now();
const failed = (await pool(jobs, 3)).filter((r) => r.code !== 0);
for (const f of failed) console.error(`\n✘ ${f.label}\n${f.output}`);
console.log(
  `verify: check, unitários e typecheck em ${Math.round((Date.now() - started) / 1000)}s`,
);
if (failed.length) process.exit(1);

if (specs.length) {
  const e2eStart = Date.now();
  const build = await run("pnpm", ["--filter", "./apps/cli", "build"]);
  if (build.code !== 0) {
    console.error(build.output);
    process.exit(1);
  }
  const child = spawn("pnpm", ["exec", "playwright", "test", ...specs], {
    cwd: root,
    shell,
    stdio: "inherit",
    // Um worker por spec, até o padrão da config: cada worker sobe uma pista de servidores.
    env: {
      ...process.env,
      E2E_WORKERS: process.env.E2E_WORKERS ?? String(Math.min(specs.length, 2)),
    },
  });
  const code = await new Promise((done) => child.on("exit", done));
  console.log(`verify: e2e em ${Math.round((Date.now() - e2eStart) / 1000)}s`);
  process.exit(code ?? 1);
}
