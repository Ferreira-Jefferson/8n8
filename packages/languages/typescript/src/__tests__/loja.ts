import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceFile } from "@8n8/model";

const ROOT = fileURLToPath(new URL("./fixtures/projeto-loja", import.meta.url));

function walk(dir: string, rel: string): SourceFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = rel === "" ? entry.name : `${rel}/${entry.name}`;
    return entry.isDirectory()
      ? walk(join(dir, entry.name), path)
      : [{ path, source: readFileSync(join(dir, entry.name), "utf8") }];
  });
}

/** The files of the `projeto-loja` fixture, as the project reader would hand them over. */
export function lojaFiles(): SourceFile[] {
  return walk(ROOT, "");
}
