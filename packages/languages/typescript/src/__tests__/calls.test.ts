import { describe, expect, it } from "vitest";
import {
  expectWellFormed,
  extract,
  lines,
  node,
  outline,
  wires,
} from "./helpers";

/** The first step of `function f`, for a one-statement body. */
function step(body: string, header = "") {
  const source = `${header}\nasync function f() {\n  ${body}\n}\n`;
  const graph = extract(source);
  expectWellFormed(graph, lines(source));
  return graph.nodes.find((n) => n.id === "fn:f/s0");
}

describe("resolved calls", () => {
  it("makes a call step to a function of the same text, with its target", () => {
    const graph = extract("function a() { b(); }\nfunction b() {}\n");

    expect(node(graph, "fn:a/s0")).toMatchObject({
      kind: "call",
      label: "b",
      target: "fn:b",
      openable: true,
    });
    expect(wires(graph, "calls")).toEqual(["fn:a -> fn:b"]);
  });

  it("resolves a call to a function defined after the caller", () => {
    expect(step("later();", "function later() {}")).toMatchObject({
      kind: "call",
      target: "fn:later",
    });
  });

  it("resolves `new Class()` to the class", () => {
    expect(step("const x = new Box();", "class Box {}")).toMatchObject({
      kind: "call",
      target: "cls:Box",
    });
  });

  it("resolves an arrow function assigned to a const", () => {
    expect(step("go();", "const go = () => 1;")).toMatchObject({
      kind: "call",
      target: "fn:go",
    });
  });

  it("prefers a call to the snippet over an external call in the same statement", () => {
    expect(
      step("const x = await fetch(url(), { a: own() });", "function own() {}"),
    ).toMatchObject({ kind: "call", target: "fn:own" });
  });

  it("points to the last definition when a name repeats", () => {
    const graph = extract(
      "function a() {}\nfunction a() {}\nfunction b() { a(); }\n",
    );

    expect(node(graph, "fn:b/s0").target).toBe("fn:a#2");
  });

  it("does not resolve a method of another object to a function with that name", () => {
    const graph = extract(
      "function save() {}\nfunction f(repo) { repo.save(); }\n",
    );

    expect(node(graph, "fn:f/s0").kind).toBe("code");
  });
});

describe("external calls", () => {
  it("keeps no step for a method on a value the code binds", () => {
    expect(step("const xs = []; xs.push(1);")?.kind).toBe("code");
    expect(step("items.forEach((i) => i);", "const items = [];")?.kind).toBe(
      "code",
    );
  });

  it("keeps no step for data built-ins", () => {
    expect(
      step("const x = Math.max(1, JSON.parse('2'), Number('3'));")?.kind,
    ).toBe("code");
    expect(step("throw new Error('x');")?.kind).toBe("code");
    expect(step("const m = new Map(); m.set(1, 2);")?.kind).toBe("code");
  });

  it("marks a call to a name the text does not define as EXTERNO", () => {
    expect(step("mystery(1);")).toMatchObject({
      kind: "external",
      label: "mystery",
      callee: "mystery",
      category: "EXTERNO",
      openable: false,
    });
    expect(step("console.log('x');")).toMatchObject({
      callee: "console.log",
      category: "EXTERNO",
    });
  });

  it("marks a call to a name from a package as EXTERNO, with the package name", () => {
    expect(step("z.string();", 'import { z } from "zod";')).toMatchObject({
      callee: "z.string",
      category: "EXTERNO",
    });
    expect(step("_.map(a);", 'import _ from "lodash";')).toMatchObject({
      callee: "lodash.map",
      category: "EXTERNO",
    });
    expect(step("l.map(a);", 'import * as l from "lodash";')).toMatchObject({
      callee: "lodash.map",
    });
    expect(step("sh(a);", 'import { shout as sh } from "yell";')).toMatchObject(
      {
        callee: "shout",
      },
    );
  });

  it("never makes a call into a relative file external", () => {
    expect(step("util.go();", 'import util from "./util";')).toMatchObject({
      kind: "code",
    });
  });

  it("keeps the table category of a call into a relative file", () => {
    expect(step("db.query(sql);", 'import db from "./db";')).toMatchObject({
      kind: "external",
      category: "BANCO",
    });
  });

  describe("HTTP", () => {
    it.each([
      ["await fetch('/a');", undefined, "fetch"],
      ["await axios.get('/a');", 'import axios from "axios";', "axios.get"],
      ["await got('/a');", 'import got from "got";', "got"],
      ["await ky.post('/a');", undefined, "ky.post"],
      ["await http.get('/a');", 'import http from "node:http";', "http.get"],
      ["await get('/a');", 'import { get } from "axios";', "get"],
      [
        "await f2('/a');",
        'import { default as f2 } from "node-fetch";',
        "default",
      ],
    ])("classifies `%s`", (code, header, callee) => {
      expect(step(code, header)).toMatchObject({ category: "HTTP", callee });
    });
  });

  describe("BANCO", () => {
    it.each([
      ["await prisma.user.findMany();", undefined, "prisma.user.findMany"],
      ["await pool.query('select 1');", "const pool = make();", "pool.query"],
      ["await db.query('select 1');", undefined, "db.query"],
      ["await conn.run('x');", undefined, "conn.run"],
      ["await knex('t').select();", 'import knex from "knex";', "knex"],
      ["const p = new Pool();", 'import { Pool } from "pg";', "Pool"],
      ["await c.find();", 'import c from "mongodb";', "mongodb.find"],
      [
        "await (await cx()).query('x');",
        "const cx = make;",
        "(await cx()).query",
      ],
      ["await rows[0].execute('x');", "const rows = [];", "rows[0].execute"],
    ])("classifies `%s`", (code, header, callee) => {
      const resolved = step(code, header);
      expect(resolved).toMatchObject({ category: "BANCO" });
      expect(resolved?.callee).toBe(callee);
    });
  });

  describe("ARQUIVO", () => {
    it.each([
      ["fs.readFileSync('a');", 'import fs from "node:fs";', "fs.readFileSync"],
      [
        "await readFile('a');",
        'import { readFile } from "fs/promises";',
        "readFile",
      ],
      [
        "await fsp.writeFile('a');",
        'import * as fsp from "node:fs/promises";',
        "fs/promises.writeFile",
      ],
      ["writeFileSync('a', 'b');", undefined, "writeFileSync"],
      ["fs.mkdirSync('a');", undefined, "fs.mkdirSync"],
    ])("classifies `%s`", (code, header, callee) => {
      expect(step(code, header)).toMatchObject({ category: "ARQUIVO", callee });
    });
  });

  describe("EMAIL", () => {
    it.each([
      [
        "nodemailer.createTransport({});",
        'import nodemailer from "nodemailer";',
        "nodemailer.createTransport",
      ],
      ["sendEmail(a);", undefined, "sendEmail"],
      ["mailer.sendMail(a);", undefined, "mailer.sendMail"],
      [
        "await sgMail.send(a);",
        'import sgMail from "@sendgrid/mail";',
        "@sendgrid/mail.send",
      ],
    ])("classifies `%s`", (code, header, callee) => {
      expect(step(code, header)).toMatchObject({ category: "EMAIL", callee });
    });
  });

  it("reads a require as an import", () => {
    expect(
      step("fs.readFileSync('a');", 'const fs = require("fs");'),
    ).toMatchObject({
      category: "ARQUIVO",
    });
    expect(
      step(
        "readFileSync('a');",
        'const { readFileSync } = require("node:fs");',
      ),
    ).toMatchObject({ category: "ARQUIVO", callee: "readFileSync" });
    expect(
      step("rf('a');", 'const { readFile: rf } = require("node:fs/promises");'),
    ).toMatchObject({ category: "ARQUIVO", callee: "readFile" });
  });

  it("sees a name bound by a parameter, a catch, a loop or a destructuring as bound", () => {
    const graph = extract(
      [
        "function f(a, { b, c: [d] }, ...rest) {",
        "  try { a.x(); } catch (e) { e.y(); }",
        "  for (const k of rest) { k.z(); }",
        "  for (const w in d) { w.q(); }",
        "  const g = (h) => h.p();",
        "  const i = j => j.p();",
        "  b.u(); d.u();",
        "}",
        "",
      ].join("\n"),
    );

    expect(graph.nodes.filter((n) => n.kind === "external")).toEqual([]);
  });

  it("resolves `a!.b()` and `a?.b()` as dotted names", () => {
    expect(step("a!.b();", "const a = 1;")?.kind).toBe("code");
    expect(
      step("fs?.readFileSync('x');", 'import fs from "fs";'),
    ).toMatchObject({
      category: "ARQUIVO",
    });
  });

  it("does not make a step of `super()` or a dynamic import", () => {
    expect(step("const m = await import('./x');")).toMatchObject({
      kind: "code",
    });
    expect(step("const m = await import('./x');")?.callee).toBeUndefined();
  });

  it("marks a computed call, a called result and a module from `import()` as a dynamic code step", () => {
    const source = [
      "async function f(o, make) {",
      "  o['k']();",
      "  make()();",
      "  const mod = await import('./x');",
      "  mod.add(1);",
      "}",
      "",
    ].join("\n");
    const graph = extract(source);
    expectWellFormed(graph, lines(source));

    expect(
      graph.nodes
        .filter((n) => n.parentId === "fn:f")
        .map((n) => [n.kind, n.callee]),
    ).toEqual([
      ["code", "o['k']"],
      ["code", "make()"],
      ["code", undefined],
      ["code", "mod.add"],
    ]);
  });

  it("makes no step of a call inside a callback or an object's function, but keeps the calls wire", () => {
    const source = [
      "function go(x) { return x; }",
      "function f() {",
      "  const h = { a: () => console.log('a'), b() { go(1); } };",
      "  [1, 2].map((x) => go(x));",
      "  setTimeout(function () { go(2); }, 10);",
      "}",
      "",
    ].join("\n");
    const graph = extract(source);
    expectWellFormed(graph, lines(source));

    expect(
      graph.nodes
        .filter((n) => n.parentId === "fn:f")
        .map((n) => [n.kind, n.label, n.target]),
    ).toEqual([
      ["code", "Código", undefined],
      ["external", "setTimeout", undefined],
    ]);
    expect(wires(graph, "calls")).toEqual(["fn:f -> fn:go"]);
  });

  it("does not take a client factory of an HTTP library as HTTP", () => {
    expect(
      step("const api = axios.create();", 'import axios from "axios";'),
    ).toMatchObject({ kind: "external", category: "EXTERNO" });
    expect(
      step("const a = new http.Agent();", 'import http from "node:http";'),
    ).toMatchObject({ kind: "external", category: "EXTERNO" });
  });

  it("chooses the first external call when no call goes to the snippet", () => {
    expect(
      step("const r = await fetch(a()); await prisma.x.y();", "const a = 1;"),
    ).toMatchObject({ callee: "fetch" });
  });

  it("does not take a receiver call as the step when a method call follows", () => {
    const resolved = step("const r = make().push(1);", "function make() {}");

    expect(resolved).toMatchObject({ kind: "call", target: "fn:make" });
  });

  it("describes every step of the fixture-like body in order", () => {
    const graph = extract(
      [
        "function f() {",
        "  const a = 1;",
        "  go();",
        "  fetch('x');",
        "  const b = 2;",
        "}",
        "function go() {}",
        "",
      ].join("\n"),
    );

    expect(outline(graph).filter(([id]) => id.startsWith("fn:f/"))).toEqual([
      ["fn:f/s0", "code", "Código"],
      ["fn:f/s1", "call", "go"],
      ["fn:f/s2", "external", "fetch"],
      ["fn:f/s3", "code", "Código"],
    ]);
  });
});
