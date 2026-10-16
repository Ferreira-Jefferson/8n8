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

// Copied from apps/cli/src/build.ts, not imported: one host never imports another
// (AD-022). Two bundles: the core as ESM (core.mjs, like the CLI's), because the
// language plugins await at the top level; the extension as CommonJS
// (extension.cjs), with vscode left out, which imports core.mjs at run time.
const extRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(extRoot, "../../..");
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

/** The core in one ESM file, every dependency inside (VSC-07). */
export async function bundleCore(outfile: string): Promise<void> {
  await build({
    entryPoints: [join(extRoot, "src/core-entry.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // Bundled CommonJS code still calls require for Node built-ins.
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);',
    },
    plugins: [grammars],
    logLevel: "error",
  });
}

/** The extension in one CommonJS file; `vscode` comes from the editor (VSC-07). */
export async function bundleExtension(outfile: string): Promise<void> {
  await build({
    entryPoints: [join(extRoot, "src/extension.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["vscode"],
    logLevel: "error",
  });
}

/** The .wasm of every `tree-sitter-*` dependency of every language plugin, and tree-sitter's runtime. */
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

/** apps/editors/vscode/dist: the extension, the grammars, the built screen and the PTS rules. */
export async function buildExtension(
  outDir = join(extRoot, "dist"),
): Promise<void> {
  const web = join(repoRoot, "apps/ui/dist");
  if (!existsSync(join(web, "index.html"))) {
    throw new Error("Construa a tela antes: pnpm --filter @8n8/ui build");
  }
  rmSync(outDir, { recursive: true, force: true });
  await bundleCore(join(outDir, "core.mjs"));
  await bundleExtension(join(outDir, "extension.cjs"));
  copyGrammars(outDir);
  cpSync(web, join(outDir, "web"), { recursive: true });
  cpSync(
    join(repoRoot, "docs/portugues-tecnico-simplificado.md"),
    join(outDir, "pts.md"),
  );
  cpSync(
    join(repoRoot, "docs/ingles-tecnico-simplificado.md"),
    join(outDir, "ste.md"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await buildExtension();
}
