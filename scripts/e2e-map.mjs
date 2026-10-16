// Refaz o mapa de cobertura dos testes e2e (e2e/coverage-map.json). Uso: pnpm e2e:map
//
// Roda a suíte inteira com E2E_COVERAGE=1: cada teste anota as funções de src/ que
// rodaram, na página e nos servidores da pista dele, e as regras de CSS que a página
// usou (e2e/test.ts). Cada worker tem os próprios servidores (e2e/lane.ts), então a
// cobertura de um teste nunca leva a de outro. O mapa é versionado: commite-o depois de
// refazê-lo. O scripts/verify.mjs o lê para escolher os specs.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const coverageDir = join(root, ".cache", "e2e-coverage");
const dist = join(root, "apps", "cli", "dist");
const out = join(root, "e2e", "coverage-map.json");
const env = { ...process.env, E2E_COVERAGE: "1" };
const shell = process.platform === "win32";

rmSync(coverageDir, { recursive: true, force: true });
execFileSync("pnpm", ["--filter", "./apps/cli", "build"], {
  cwd: root,
  env,
  stdio: "inherit",
  shell,
});
const run = spawnSync("pnpm", ["exec", "playwright", "test"], {
  cwd: root,
  env,
  stdio: "inherit",
  shell,
});

const repoPath = (path) => relative(root, path).replaceAll("\\", "/");
const column = (list) =>
  `[\n${list.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`;

// Cada função (`<arquivo>:<linha inicial>-<linha final>`) e cada seletor entra uma vez
// na tabela; o spec guarda os índices dos que os testes dele executaram ou usaram.
const runBySpec = new Map();
for (const file of existsSync(coverageDir) ? readdirSync(coverageDir) : []) {
  for (const line of readFileSync(join(coverageDir, file), "utf8").split(
    "\n",
  )) {
    if (!line) continue;
    const { spec, functions, selectors } = JSON.parse(line);
    const run = runBySpec.get(spec) ?? {
      functions: new Set(),
      selectors: new Set(),
    };
    for (const f of functions) run.functions.add(f);
    for (const s of selectors) run.selectors.add(s);
    runBySpec.set(spec, run);
  }
}
const table = (key) =>
  [...new Set([...runBySpec.values()].flatMap((r) => [...r[key]]))].sort();
const functions = table("functions");
const selectors = table("selectors");
const indexOf = (list) => new Map(list.map((item, i) => [item, i]));
const functionIndex = indexOf(functions);
const selectorIndex = indexOf(selectors);
const specs = Object.fromEntries(
  [...runBySpec.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([spec, run]) => [
      spec,
      {
        functions: [...run.functions]
          .map((f) => functionIndex.get(f))
          .sort((a, b) => a - b),
        selectors: [...run.selectors]
          .map((s) => selectorIndex.get(s))
          .sort((a, b) => a - b),
      },
    ]),
);

/** Todo arquivo de src/ que entrou num bundle, rodando uma função ou não. */
const loaded = new Set();
// Os mapas da página ficam em apps/ui/dist, de onde o Vite os escreveu (e2e/test.ts, builtAt).
const uiAssets = join(root, "apps", "ui", "dist", "assets");
const maps = [
  ...readdirSync(dist).map((f) => join(dist, f)),
  ...readdirSync(uiAssets).map((f) => join(uiAssets, f)),
].filter((f) => f.endsWith(".map"));
for (const map of maps) {
  for (const source of JSON.parse(readFileSync(map, "utf8")).sources) {
    const path = repoPath(resolve(dirname(map), source));
    if (!path.includes("node_modules") && !path.startsWith("..")) {
      loaded.add(path);
    }
  }
}

const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
  cwd: root,
})
  .toString()
  .trim();
writeFileSync(
  out,
  // Uma função ou seletor por linha, e os índices de um spec numa linha só: o diff do
  // mapa refeito mostra o que mudou.
  [
    "{",
    `  "commit": ${JSON.stringify(commit)},`,
    `  "loaded": ${column([...loaded].sort())},`,
    `  "functions": ${column(functions)},`,
    `  "selectors": ${column(selectors)},`,
    `  "specs": {\n${Object.entries(specs)
      .map(
        ([spec, run]) => `    ${JSON.stringify(spec)}: ${JSON.stringify(run)}`,
      )
      .join(",\n")}\n  }`,
    "}\n",
  ].join("\n"),
);
console.log(
  `\ne2e-map: ${Object.keys(specs).length} specs, ${functions.length} funções, ${selectors.length} seletores em ${repoPath(out)}`,
);
if (run.status !== 0) {
  console.error(
    "e2e-map: a suíte falhou; o mapa pode faltar arquivos dos testes que falharam.",
  );
  process.exit(run.status ?? 1);
}
