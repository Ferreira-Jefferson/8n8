import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const scripts = (
  JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

describe("pnpm dev and pnpm start run the cli with the repository .env (DIST-15)", () => {
  it("dev:server runs the cli source with --env-file-if-exists=.env", () => {
    expect(scripts["dev:server"]).toMatch(
      /--env-file-if-exists=\.env apps\/cli\/src\/main\.ts\b/,
    );
  });

  it("start runs the built cli with --env-file-if-exists=.env", () => {
    expect(scripts.start).toMatch(
      /node --env-file-if-exists=\.env apps\/cli\/dist\/8n8\.mjs\b/,
    );
  });
});
