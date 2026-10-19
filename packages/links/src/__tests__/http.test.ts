import { describe, expect, it } from "vitest";
import { httpLinker } from "../http";
import { linkProject } from "../link";
import {
  contextOf,
  fileNode,
  innerNode,
  nodeId,
  offer,
  request,
} from "./helpers";

const ctx = contextOf({});

function matches(requestKey: string, offerKey: string): boolean {
  return httpLinker.matches(
    request("http", requestKey, "a.py", "c"),
    offer("http", offerKey, "b.ts", "h"),
    ctx,
  );
}

describe("http linker: matching", () => {
  it("matches the same method and path", () => {
    expect(matches("POST /api/frete", "POST /api/frete")).toBe(true);
  });

  it("does not match another method", () => {
    expect(matches("GET /api/frete", "POST /api/frete")).toBe(false);
  });

  it("does not match another path", () => {
    expect(matches("POST /api/frete", "POST /api/prazo")).toBe(false);
  });

  it("does not match paths with a different depth", () => {
    expect(matches("POST /api/frete", "POST /api/frete/novo")).toBe(false);
  });

  it("ignores the case of the method", () => {
    expect(matches("post /api/frete", "POST /api/frete")).toBe(true);
  });

  it("keeps the case of the path", () => {
    expect(matches("POST /api/Frete", "POST /api/frete")).toBe(false);
  });

  it("matches any method for a request with `*`", () => {
    expect(matches("* /api/frete", "DELETE /api/frete")).toBe(true);
  });

  it("matches any method for an offer with `*`", () => {
    expect(matches("PUT /api/frete", "* /api/frete")).toBe(true);
  });

  it("ignores scheme, host, port and query of the URL", () => {
    expect(
      matches(
        "POST https://exemplo.com:8080/api/frete?x=1&y=2",
        "POST /api/frete",
      ),
    ).toBe(true);
  });

  it("ignores the fragment", () => {
    expect(matches("GET /api/frete#topo", "GET /api/frete")).toBe(true);
  });

  it("drops only the host of a URL with no path", () => {
    expect(matches("GET http://localhost:3000", "GET /")).toBe(true);
  });

  it("normalizes the trailing slash", () => {
    expect(matches("GET /api/frete/", "GET /api/frete")).toBe(true);
    expect(matches("GET /api/frete", "GET /api/frete/")).toBe(true);
  });

  it("treats a bare URL as any method", () => {
    expect(matches("http://localhost/api/frete", "POST /api/frete")).toBe(true);
    expect(matches("/api/frete", "POST /api/frete")).toBe(true);
  });

  it("treats a first word that is not a method as part of a bare path", () => {
    expect(matches("/api/frete grande", "GET /api/frete/grande")).toBe(false);
  });

  it("matches the route parameter forms :id, {id} and <id>", () => {
    expect(matches("GET /users/42", "GET /users/:id")).toBe(true);
    expect(matches("GET /users/42", "GET /users/{id}")).toBe(true);
    expect(matches("GET /users/42", "GET /users/<id>")).toBe(true);
  });

  it("matches a parameter in the request too", () => {
    expect(matches("GET /users/{id}", "GET /users/42")).toBe(true);
  });

  it("matches a parameter with any segment but keeps the others", () => {
    expect(matches("GET /users/42/posts", "GET /users/:id/comments")).toBe(
      false,
    );
  });
});

describe("http linker: label", () => {
  it("writes the method and path of the request", () => {
    const label = httpLinker.label(
      request("http", "post https://x.com/api/frete/?q=1", "a.py", "c"),
      offer("http", "POST /api/frete", "b.ts", "h"),
    );
    expect(label).toBe("HTTP POST /api/frete");
  });

  it("takes the method from the offer when the request has none", () => {
    const label = httpLinker.label(
      request("http", "/api/frete", "a.py", "c"),
      offer("http", "PATCH /api/frete", "b.ts", "h"),
    );
    expect(label).toBe("HTTP PATCH /api/frete");
  });
});

describe("http channel through linkProject", () => {
  const nodes = [
    fileNode("a.py"),
    innerNode("a.py", "c"),
    fileNode("b.ts"),
    innerNode("b.ts", "h"),
    fileNode("c.ts"),
    innerNode("c.ts", "h"),
    fileNode("d.py"),
    innerNode("d.py", "h"),
  ];

  it("links a request to the offer with a calls edge", () => {
    const out = linkProject({
      nodes,
      offers: [offer("http", "POST /api/frete", "b.ts", "h")],
      requests: [request("http", "POST /api/frete", "a.py", "c")],
    });
    expect(out.edges).toEqual([
      {
        id: `link:http:${nodeId("a.py", "c")}->${nodeId("b.ts", "h")}`,
        kind: "calls",
        source: nodeId("a.py", "c"),
        target: nodeId("b.ts", "h"),
        label: "HTTP POST /api/frete",
      },
    ]);
    expect(out.unlinked).toEqual([]);
    expect(out.ambiguous).toEqual([]);
  });

  it("marks the wire to check, with the code and the place of the call, when the URL base is known only at run time", () => {
    const req = {
      ...request("http", "GET /users", "b.ts", "h"),
      line: 7,
      dynamicBase: "config.baseUrl",
    };
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /users", "d.py", "h")],
      requests: [req],
    });
    expect(out.edges.map((e) => e.toCheck)).toEqual([
      { reason: "dynamic-base", code: "config.baseUrl", path: "b.ts", line: 7 },
    ]);
  });

  it("keeps a wire to check when another call of the same node is literal", () => {
    const literal = request("http", "GET /users", "b.ts", "h");
    const dynamic = { ...literal, line: 9, dynamicBase: "base" };
    for (const requests of [
      [literal, dynamic],
      [dynamic, literal],
    ]) {
      const out = linkProject({
        nodes,
        offers: [offer("http", "GET /users", "d.py", "h")],
        requests,
      });
      expect(out.edges.map((e) => e.toCheck?.code)).toEqual(["base"]);
      // The joined wire says it holds a proven link too.
      expect(out.edges.map((e) => e.links)).toEqual([
        { proven: 1, toCheck: 1 },
      ]);
    }
  });

  it("may link inside the same language", () => {
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /ping", "d.py", "h")],
      requests: [request("http", "GET /ping", "a.py", "c")],
    });
    expect(out.edges).toHaveLength(1);
  });

  it("leaves a request with no offer as unlinked", () => {
    const req = request("http", "GET /nada", "a.py", "c");
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /ping", "b.ts", "h")],
      requests: [req],
    });
    expect(out.edges).toEqual([]);
    expect(out.unlinked).toEqual([req]);
  });

  it("sends a request with two offers to ambiguous, and draws a wire to check to each", () => {
    const req = request("http", "GET /users/:id", "a.py", "c", 5);
    const out = linkProject({
      nodes,
      offers: [
        offer("http", "GET /users/:id", "c.ts", "h"),
        offer("http", "GET /users/{id}", "b.ts", "h"),
      ],
      requests: [req],
    });
    const toCheck = {
      reason: "ambiguous",
      targets: 2,
      path: "a.py",
      line: 5,
    };
    expect(out.edges.map((e) => [e.target, e.toCheck])).toEqual([
      [nodeId("b.ts", "h"), toCheck],
      [nodeId("c.ts", "h"), toCheck],
    ]);
    expect(out.unlinked).toEqual([]);
    expect(out.ambiguous).toEqual([
      {
        request: req,
        candidates: [
          offer("http", "GET /users/{id}", "b.ts", "h"),
          offer("http", "GET /users/:id", "c.ts", "h"),
        ],
      },
    ]);
  });

  it("draws at most three wires for an ambiguous request, and says how many targets match", () => {
    const files = ["b.ts", "c.ts", "d.py", "e.ts"];
    const out = linkProject({
      nodes: [...nodes, fileNode("e.ts"), innerNode("e.ts", "h")],
      offers: files.map((f) => offer("http", "GET /ping", f, "h")),
      requests: [request("http", "GET /ping", "a.py", "c")],
    });
    expect(out.edges).toHaveLength(3);
    expect(out.edges.every((e) => e.toCheck?.targets === 4)).toBe(true);
    expect(out.ambiguous[0]?.candidates).toHaveLength(4);
  });

  it("marks a literal path that meets only a parameter of the route as to check: /metrics and /{slug}", () => {
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /{slug}", "d.py", "h")],
      requests: [request("http", "GET /metrics", "b.ts", "h", 3)],
    });
    expect(out.edges.map((e) => e.toCheck)).toEqual([
      { reason: "param-route", path: "b.ts", line: 3 },
    ]);
  });

  it("prefers the literal route to one with a parameter, and links it proven", () => {
    const out = linkProject({
      nodes,
      offers: [
        offer("http", "GET /users/{uid}", "d.py", "h"),
        offer("http", "GET /users/me", "a.py", "c"),
      ],
      requests: [request("http", "GET /users/me", "b.ts", "h")],
    });
    expect(out.ambiguous).toEqual([]);
    expect(out.edges.map((e) => [e.target, e.toCheck])).toEqual([
      [nodeId("a.py", "c"), undefined],
    ]);
  });

  it("keeps a parameter of the request against a parameter of the route proven: /users/:param and /users/{id}", () => {
    const out = linkProject({
      nodes,
      offers: [offer("http", "GET /users/{id}", "d.py", "h")],
      requests: [request("http", "GET /users/:param", "b.ts", "h")],
    });
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]?.toCheck).toBeUndefined();
  });
});
