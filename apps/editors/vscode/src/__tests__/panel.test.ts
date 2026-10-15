import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataPaths, panelOptions } from "../panel";

describe("panelOptions (VSC-12)", () => {
  it("lets scripts run and reads only the packaged screen", () => {
    const webRoot = { path: "/ext/dist/web" };
    const options = panelOptions(webRoot);
    expect(options).toEqual({
      enableScripts: true,
      localResourceRoots: [webRoot],
      retainContextWhenHidden: true,
    });
    expect(options.localResourceRoots[0]).toBe(webRoot);
  });
});

describe("dataPaths (VSC-05)", () => {
  it("puts the cache and the history under the editor's global storage", () => {
    expect(dataPaths("C:/storage/8n8", join)).toEqual({
      cacheDir: join("C:/storage/8n8", "cache"),
      historyFile: join("C:/storage/8n8", "historico.db"),
    });
  });
});
