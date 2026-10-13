import { describe, expect, it } from "vitest";
import { classify } from "../classify";

describe("classify", () => {
  it.each([
    ["requests.get", "HTTP"],
    ["httpx.post", "HTTP"],
    ["urllib.request.urlopen", "HTTP"],
    ["aiohttp.ClientSession", "HTTP"],
    ["sqlite3.connect", "BANCO"],
    ["psycopg.connect", "BANCO"],
    ["sqlalchemy.create_engine", "BANCO"],
    ["cur.execute", "BANCO"],
    ["conn.commit", "BANCO"],
    ["open", "ARQUIVO"],
    ["pathlib.Path", "ARQUIVO"],
    ["smtplib.SMTP", "EMAIL"],
    ["boto3.client", "EXTERNO"],
  ])("%s -> %s", (callee, category) => {
    expect(classify(callee)).toBe(category);
  });

  it("matches prefixes by whole name segment", () => {
    expect(classify("requests_cache.install")).toBe("EXTERNO");
  });

  it("tests the table in order, so HTTP wins over BANCO", () => {
    expect(classify("requests.Session.execute")).toBe("HTTP");
  });
});
