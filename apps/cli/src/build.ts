import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(cliRoot, "../..");
const languagesDir = join(repoRoot, "packages/languages");

/**
 * Inside the bundle, a language plugin's `createRequire(...).resolve("<pkg>/<file>.wasm")`
 * points to `grammars/<file>.wasm` next to the bundle. The plugins stay as they are.
 */
const GRAMMAR_SHIM = `import { fileURLToPath } from "node:url";
export function createRequire() {
  return {
    resolve: (spec) =>
      fileURLToPath(new URL("./grammars/" + spec.split("/").pop(), import.meta.url)),
  };
}`;

const grammars: Plugin = {
  name: "grammars",
  setup(b) {
    b.onResolve({ filter: /^node:module$/ }, (args) =>
      args.importer.replaceAll("\\", "/").includes("/packages/languages/")
        ? { path: "grammar-shim", namespace: "grammars" }
        : undefined,
    );
    b.onLoad({ filter: /.*/, namespace: "grammars" }, () => ({
      contents: GRAMMAR_SHIM,
      loader: "js",
    }));
  },
};

/** One ESM file with every dependency inside: the package declares none (DIST-16). */
export async function bundle(entry: string, outfile: string): Promise<void> {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Bundled CommonJS code still calls require for Node built-ins.
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
    },
    plugins: [grammars],
    logLevel: "warning",
  });
}

/**
 * Copies tree-sitter's runtime and the .wasm of every `tree-sitter-*` dependency of every
 * language plugin: a new plugin's grammar ships with no edit here.
 */
export function copyGrammars(outDir: string): void {
  mkdirSync(join(outDir, "grammars"), { recursive: true });
  for (const plugin of readdirSync(languagesDir)) {
    const manifest = join(languagesDir, plugin, "package.json");
    if (!existsSync(manifest)) continue;
    const deps = Object.keys(
      (JSON.parse(readFileSync(manifest, "utf8")) as { dependencies?: object })
        .dependencies ?? {},
    );
    for (const dep of deps.filter((d) => d.startsWith("tree-sitter-"))) {
      const dir = join(languagesDir, plugin, "node_modules", dep);
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".wasm"))) {
        cpSync(join(dir, file), join(outDir, "grammars", file));
      }
    }
  }
  cpSync(
    join(
      languagesDir,
      "treesitter/node_modules/web-tree-sitter/web-tree-sitter.wasm",
    ),
    join(outDir, "web-tree-sitter.wasm"),
  );
}

/** apps/cli/dist: the two bundles, the grammars, the built screen and the PTS rules. */
export async function buildCli(outDir = join(cliRoot, "dist")): Promise<void> {
  const web = join(repoRoot, "apps/web/dist");
  if (!existsSync(join(web, "index.html"))) {
    throw new Error("Construa a tela antes: pnpm --filter @8n8/web build");
  }
  rmSync(outDir, { recursive: true, force: true });
  // Two files: 8n8.mjs sets the warning filter, then loads cli.mjs (see bin.ts).
  await bundle(join(cliRoot, "src/installed.ts"), join(outDir, "cli.mjs"));
  await bundle(join(cliRoot, "src/bin.ts"), join(outDir, "8n8.mjs"));
  copyGrammars(outDir);
  cpSync(web, join(outDir, "web"), { recursive: true });
  cpSync(
    join(repoRoot, "docs/portugues-tecnico-simplificado.md"),
    join(outDir, "pts.md"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildCli();
}
