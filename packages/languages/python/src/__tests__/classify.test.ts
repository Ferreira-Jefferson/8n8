import { describe, expect, it } from "vitest";
import { classify, classifyUnknown } from "../classify";

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

describe("classifyUnknown", () => {
  it.each(["db.salvar", "cursor.x", "conn.x", "connection.x", "session.x"])(
    "(a) %s -> BANCO by its receiver",
    (callee) => {
      expect(classifyUnknown(callee)).toBe("BANCO");
    },
  );

  it.each(["dbx.salvar", "DB.salvar", "meu.db.salvar"])(
    "(a) %s does not match: the whole first segment, case included",
    (callee) => {
      expect(classifyUnknown(callee)).toBe("EXTERNO");
    },
  );

  it.each(["enviar_email", "sendEmail", "notificar.EMAIL_cliente", "email"])(
    "(b) %s -> EMAIL by its last segment",
    (callee) => {
      expect(classifyUnknown(callee)).toBe("EMAIL");
    },
  );

  it("(b) emailer.enviar does not match: email is not in the last segment", () => {
    expect(classifyUnknown("emailer.enviar")).toBe("EXTERNO");
  });

  it("(a) wins over (b)", () => {
    expect(classifyUnknown("db.enviar_email")).toBe("BANCO");
  });

  it.each([
    ["requests.get", "HTTP"],
    ["open", "ARQUIVO"],
  ])("(c) %s -> %s by the table", (callee, category) => {
    expect(classifyUnknown(callee)).toBe(category);
  });

  it.each(["validar_pedido", "sum"])("(d) %s -> EXTERNO", (callee) => {
    expect(classifyUnknown(callee)).toBe("EXTERNO");
  });
});
