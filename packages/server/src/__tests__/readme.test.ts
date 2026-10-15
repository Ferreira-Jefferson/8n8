import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IGNORED_DIRS } from "@8n8/input";
import { describe, expect, it } from "vitest";
import { languagePlugins } from "../core";

const readme = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../README.md"),
  "utf8",
);

// The README says what the reader skips; a folder added in the code must be added there too (CLEAN-03).
describe("the README tells what 8n8 reads of a folder (CLEAN-03)", () => {
  it("says it follows the .gitignore of the folder and of each subfolder", () => {
    expect(readme).toContain("## O que o 8n8 lê de uma pasta");
    expect(readme).toContain(
      "Ele lê o `.gitignore` da raiz e o de cada subpasta",
    );
  });

  it.each([...IGNORED_DIRS, ...languagePlugins.flatMap((p) => p.ignoredDirs)])(
    "names the skipped folder %s",
    (dir) => {
      expect(readme).toContain(`\`${dir}\``);
    },
  );

  it("says the history keeps only the path of a folder", () => {
    expect(readme).toContain(
      "O histórico guarda só o caminho de cada pasta, nunca o código.",
    );
  });
});
