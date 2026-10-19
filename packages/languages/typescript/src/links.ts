import { innermost } from "@8n8/lang-treesitter";
import {
  childId,
  fileId,
  type Graph,
  type LinkRequest,
  type NodeId,
  type Offer,
} from "@8n8/model";
import type { Node } from "web-tree-sitter";
import { boundNames } from "./bound";
import { allocateTopLevel } from "./build-graph";
import { dottedName } from "./calls";
import { classify, moduleRoot } from "./classify";
import {
  argumentsOf,
  type Binding,
  importBindings,
  stringValue,
} from "./imports";
import {
  type ExportInfo,
  type ModuleIndex,
  resolveModulePath,
} from "./modules";

export interface FileLinks {
  offers: Offer[];
  requests: LinkRequest[];
}

/** A `${...}` inside a template or a `+` chain: something the code decides at run time. */
const HOLE = "\u0000";

const HTTP_VERBS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
]);
const ROUTE_VERBS = new Set([...HTTP_VERBS, "all"]);
const PROCESS_CALLS = new Set([
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "spawn",
  "spawnSync",
  "fork",
]);
/** Names that exist without a declaration, besides the built-ins of `boundNames`. */
const AMBIENT = new Set([
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "queueMicrotask",
  "structuredClone",
  "atob",
  "btoa",
]);
/** `app`, `router`, `server`, `fastify`, `api`, `routes`, or `userRouter`, `mainApp`. */
const ROUTER =
  /^(?:app|router|server|fastify|api|routes?)$|(?:Router|App|Routes|Server|Api)$/;
/** `axios.create(...)`, `got.extend(...)`, `ky.create(...)`: a client of these libraries, never a router. */
const CLIENT_FACTORIES = new Map([
  ["axios", new Set(["create"])],
  ["got", new Set(["extend"])],
  ["ky", new Set(["create", "extend"])],
]);
/** `new Hono()`, `new Router()`: a router of these libraries, by `new`. */
const ROUTER_CLASSES = new Set([
  "hono",
  "express",
  "koa-router",
  "@koa/router",
]);
/** `express()`, `express.Router()`, `Router()`, `fastify()`: a router of these libraries, by a call. */
const ROUTER_CALLS = new Set(["express", "fastify"]);
/** What a route handler can be: a function, a name, a member or a call that gives one. */
const HANDLERS = new Set([
  "arrow_function",
  "function_expression",
  "function",
  "identifier",
  "member_expression",
  "call_expression",
]);
/** A value that is data: a name bound to one is not a handler. */
const DATA = new Set([
  "object",
  "array",
  "string",
  "template_string",
  "number",
  "true",
  "false",
  "null",
]);
/** A token that names a file: `a.py`, `./b.ts`, `scripts/run.sh`. */
const PATH_TOKEN = /^[\w@./\\-]*[\w-]\.[A-Za-z][A-Za-z0-9]*$/;

/** Text with `HOLE` where the value is known only at run time, and the code of each hole in order. */
export interface Read {
  text: string;
  holes: string[];
}

const EMPTY: Read = { text: "", holes: [] };
const HOST = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

function concat(...reads: Read[]): Read {
  return {
    text: reads.map((r) => r.text).join(""),
    holes: reads.flatMap((r) => r.holes),
  };
}

/** The pieces of a string-like expression, in order: a template and a `+` chain open into theirs. */
function piecesOf(n: Node): Node[] {
  switch (n.type) {
    case "template_string":
      return n.children.filter((c) => c.isNamed);
    case "parenthesized_expression":
      return n.namedChildren[0] ? piecesOf(n.namedChildren[0]) : [n];
    case "binary_expression": {
      const left = n.childForFieldName("left");
      const right = n.childForFieldName("right");
      return n.childForFieldName("operator")?.text === "+" && left && right
        ? [...piecesOf(left), ...piecesOf(right)]
        : [n];
    }
    default:
      return [n];
  }
}

/** The text of some pieces, with `HOLE` for each one that is not text. */
function readPieces(pieces: Node[]): Read {
  const holes: string[] = [];
  const text = pieces
    .map((p) => {
      if (p.type === "string") return p.text.slice(1, -1);
      if (p.type === "template_substitution") {
        holes.push((p.namedChildren[0] ?? p).text.replace(/\s+/g, " "));
        return HOLE;
      }
      if (p.parent?.type === "template_string") return p.text;
      holes.push(p.text.replace(/\s+/g, " "));
      return HOLE;
    })
    .join("");
  return { text, holes };
}

/** The read itself, or null when no part of it is text. */
function withText(read: Read): Read | null {
  return read.text.replaceAll(HOLE, "") === "" ? null : read;
}

/**
 * The text of a string-like expression, with `HOLE` where the value is not
 * known, and the code of each hole in order; null when no part of it is text.
 */
function readText(node: Node | null): Read | null {
  return node === null ? null : withText(readPieces(piecesOf(node)));
}

function textOf(node: Node | null): string | null {
  return readText(node)?.text ?? null;
}

/**
 * The base URL of a client (`baseURL: "/api"`). A base with a host, or one known only at run time, is a hole
 * with the code of the value: the path may belong to another service.
 */
function baseOf(node: Node | null): Read {
  if (node === null) return EMPTY;
  const code = node.text.replace(/\s+/g, " ");
  const read = readText(node);
  if (read === null) return { text: HOLE, holes: [code] };
  const host = HOST.exec(read.text)?.[0];
  if (host === undefined) return read;
  const hostHoles = host.split(HOLE).length - 1;
  return {
    text: HOLE + read.text.slice(host.length),
    holes: [code, ...read.holes.slice(hostHoles)],
  };
}

/** `base` and `url` as a client joins them; an absolute URL keeps its own. */
function joinBase(base: Read, url: Read): Read {
  if (HOST.test(url.text) || url.text.startsWith(HOLE)) return url;
  return {
    text: `${base.text.replace(/\/+$/, "")}/${url.text.replace(/^\/+/, "")}`,
    holes: [...base.holes, ...url.holes],
  };
}

/** A route under the prefix of its router: `/api` and `/users` give `/api/users`. */
function joinPath(prefix: string, path: string): string {
  if (prefix === "") return path;
  if (path === "" || path === "/") return prefix;
  return prefix.replace(/\/+$/, "") + path;
}

/**
 * The path of a URL (`https://h/api/x?q=1` → `/api/x`); `:param` for a hole. Null if not a path.
 * `dynamicBase` is the code of the value the URL starts with, or of its host, when the code decides it at run
 * time (`${config.baseUrl}/users`): the path may belong to another service.
 */
function urlOf(
  read: Read | null,
): { path: string; dynamicBase?: string } | null {
  if (read === null) return null;
  let { text } = read;
  const lead = text.length - text.replace(new RegExp(`^${HOLE}+`), "").length;
  text = text.slice(lead);
  const absolute = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)(.*)$/i.exec(text);
  const path = absolute ? `/${(absolute[2] ?? "").replace(/^\//, "")}` : text;
  if (!path.startsWith("/")) return null;
  const dynamic = lead > 0 || (absolute?.[1] ?? "").includes(HOLE);
  return {
    path: path.replace(/[?#].*$/, "").replaceAll(HOLE, ":param"),
    ...(dynamic && read.holes[0] ? { dynamicBase: read.holes[0] } : {}),
  };
}

/** The value of `name: ...` in an object literal. */
function propertyOf(object: Node | undefined, name: string): Node | null {
  for (const pair of object?.namedChildren ?? []) {
    if (pair.type !== "pair") continue;
    const key = pair.childForFieldName("key")?.text.replace(/^["']|["']$/g, "");
    if (key === name) return pair.childForFieldName("value");
  }
  return null;
}

/** `{ method: "post" }` → `POST`; no `method` → `GET`; not a string → `*`. */
function methodOf(options: Node | undefined): string {
  if (options?.type !== "object") return "GET";
  const value = propertyOf(options, "method");
  if (value === null) {
    const shorthand = options.namedChildren.some(
      (c) => c.type === "shorthand_property_identifier" && c.text === "method",
    );
    return shorthand ? "*" : "GET";
  }
  return stringValue(value)?.toUpperCase() ?? "*";
}

/** How a call of a function that wraps a request becomes one: `post(url, body)` → `fetch(url, { method: "POST" })`. */
interface Wrapper {
  /** The argument with the URL, and the text the function puts before and after it. */
  param: number;
  before: Read;
  after: Read;
  /** The base of the client the function calls; null for none. */
  base: Read | null;
  /** A method of its own, or the one of the options in argument `param`. */
  method: string | { param: number };
}

/** What a file tells the other files about HTTP, from its own text only: plain JSON. */
export interface HttpFacts {
  /** A client (`const api = axios.create(...)`) by local name, with its base URL. */
  clients: [string, Read][];
  /** A top-level function that wraps a request, by local name. */
  wrappers: [string, Wrapper][];
  /** A router of another file this file mounts under a prefix: `app.use("/api", users)`, `users` imported. */
  mounts: { prefix: string; module: string; imported: string }[];
}

/** The HTTP facts of every file of the project, to follow a client, a wrapper or a router across files. */
export interface ProjectHttp {
  index: ModuleIndex;
  facts: Map<string, HttpFacts>;
}

/** A call that sends a request: where its URL is, what is around it, and its method. */
interface Target {
  url: Node | undefined;
  before: Read;
  after: Read;
  base: Read | null;
  /** A method of its own, or the one of these options. */
  method: string | { options: Node | undefined };
  /** A call of a wrapper: it is a request only when its own argument has text (`post("/x")`, not `load(id)`). */
  wrapper: boolean;
}

/** The method of options seen inside a function: one of its parameters, when the options are it or spread it. */
function methodIn(
  options: Node | undefined,
  params: string[],
): Wrapper["method"] {
  if (options?.type === "identifier" && params.includes(options.text)) {
    return { param: params.indexOf(options.text) };
  }
  if (options?.type === "object" && methodOf(options) === "GET") {
    for (const c of options.namedChildren) {
      const spread = c.type === "spread_element" ? c.namedChildren[0] : null;
      if (spread?.type === "identifier" && params.includes(spread.text)) {
        return { param: params.indexOf(spread.text) };
      }
    }
  }
  return methodOf(options);
}

/** The wrapper a request inside a function makes of it, when the URL is one parameter, alone or in a template. */
function wrapperFrom(target: Target, params: string[]): Wrapper | null {
  if (!target.url) return null;
  const pieces = piecesOf(target.url);
  const paramAt = (p: Node): number => {
    const code = p.type === "template_substitution" ? p.namedChildren[0] : p;
    return code?.type === "identifier" ? params.indexOf(code.text) : -1;
  };
  const at = pieces.findIndex((p) => paramAt(p) >= 0);
  const piece = pieces[at];
  if (piece === undefined || pieces.slice(at + 1).some((p) => paramAt(p) >= 0))
    return null;
  return {
    param: paramAt(piece),
    before: concat(target.before, readPieces(pieces.slice(0, at))),
    after: concat(readPieces(pieces.slice(at + 1)), target.after),
    base: target.base,
    method:
      typeof target.method === "string"
        ? target.method
        : methodIn(target.method.options, params),
  };
}

/** The parameter names of a function, `""` for a pattern. */
function paramsOf(fn: Node): string[] {
  const single = fn.childForFieldName("parameter");
  if (single) return [single.text];
  return (fn.childForFieldName("parameters")?.namedChildren ?? [])
    .filter((p) => p.type !== "comment")
    .map((p) => {
      const pattern = p.childForFieldName("pattern");
      return pattern?.type === "identifier" ? pattern.text : "";
    });
}

/** The top-level functions of a file, by name: `function f() {}` and `const f = () => {}`, exported or not. */
function topFunctions(root: Node): { name: string; fn: Node }[] {
  const out: { name: string; fn: Node }[] = [];
  for (const statement of root.namedChildren) {
    const node =
      statement.type === "export_statement"
        ? statement.childForFieldName("declaration")
        : statement;
    if (node?.type === "function_declaration") {
      const name = node.childForFieldName("name")?.text;
      if (name) out.push({ name, fn: node });
    }
    if (
      node?.type !== "lexical_declaration" &&
      node?.type !== "variable_declaration"
    )
      continue;
    for (const d of node.namedChildren) {
      const name = d.childForFieldName("name");
      const value = d.childForFieldName("value");
      if (
        name?.type === "identifier" &&
        (value?.type === "arrow_function" ||
          value?.type === "function_expression" ||
          value?.type === "function")
      )
        out.push({ name: name.text, fn: value });
    }
  }
  return out;
}

/** What one file knows about HTTP: its clients, its wrappers, and how to read a call. */
interface FileHttp {
  clients: Map<string, Read>;
  wrappers: Map<string, Wrapper>;
  /** Names bound to data, never a route handler. */
  dataNames: Set<string>;
  targetOf(call: Node): Target | null;
  /** A name the file creates or mounts as a router. */
  isRouter(name: string): boolean;
  /** The prefixes a router's routes take, from `basePath` and from where it is mounted; `[""]` for none. */
  prefixesOf(name: string): string[];
  /** The routers of other files this file mounts. */
  mounts: HttpFacts["mounts"];
}

function scanHttp(
  root: Node,
  aliases: Map<string, Binding>,
  bound: Set<string>,
  isTopLevel: (name: string) => boolean,
  imported: (name: string) => {
    client?: Read | undefined;
    wrapper?: Wrapper | undefined;
  },
  mountedFrom: (name: string) => string[],
): FileHttp {
  const libOf = (head: string): string | null => {
    const binding = aliases.get(head);
    if (binding) return moduleRoot(binding.module);
    return bound.has(head) ? null : head;
  };
  /** A router made by `new Hono()`, `express.Router()`..., with its `basePath`, or one made from another router. */
  const routerOf = (
    value: Node,
  ): { parent: string | null; path: string } | null => {
    const fn = value.childForFieldName(
      value.type === "new_expression" ? "constructor" : "function",
    );
    if (!fn) return null;
    if (
      value.type === "call_expression" &&
      fn.type === "member_expression" &&
      fn.childForFieldName("property")?.text === "basePath"
    ) {
      const path = stringValue(argumentsOf(value)[0] ?? null);
      const object = fn.childForFieldName("object");
      if (path === null || !object) return null;
      if (object.type === "identifier") return { parent: object.text, path };
      const inner = routerOf(object);
      return (
        inner && { parent: inner.parent, path: joinPath(inner.path, path) }
      );
    }
    const [head = "", ...rest] = dottedName(fn)?.split(".") ?? [];
    const lib = head === "" ? null : libOf(head);
    if (value.type === "new_expression") {
      return ROUTER_CLASSES.has(lib ?? "") && rest.length === 0
        ? { parent: null, path: "" }
        : null;
    }
    const binding = aliases.get(head);
    const made =
      value.type === "call_expression" &&
      ROUTER_CALLS.has(lib ?? "") &&
      (rest.length === 1
        ? rest[0] === "Router"
        : rest.length === 0 &&
          (binding?.kind !== "named" ||
            binding.imported === "Router" ||
            binding.imported === lib));
    return made ? { parent: null, path: "" } : null;
  };
  const routers = new Map<string, { parent: string | null; path: string }>();
  const clients = new Map<string, Read>();
  const dataNames = new Set<string>();
  for (const declarator of root.descendantsOfType("variable_declarator")) {
    const name = declarator.childForFieldName("name");
    const value = declarator.childForFieldName("value");
    if (name?.type !== "identifier" || !value) continue;
    if (DATA.has(value.type)) dataNames.add(name.text);
    const router = routerOf(value);
    if (router) routers.set(name.text, router);
    const factory =
      value.type === "call_expression"
        ? value.childForFieldName("function")
        : null;
    const [head = "", method = "", ...more] =
      (factory ? dottedName(factory)?.split(".") : undefined) ?? [];
    const lib = head === "" ? null : libOf(head);
    if (more.length === 0 && CLIENT_FACTORIES.get(lib ?? "")?.has(method)) {
      const options = argumentsOf(value)[0];
      const base = propertyOf(
        options,
        lib === "axios" ? "baseURL" : "prefixUrl",
      );
      clients.set(name.text, baseOf(base));
    }
  }

  const wrappers = new Map<string, Wrapper>();
  const targetOf = (call: Node): Target | null => {
    const fn = call.childForFieldName("function");
    const name = fn ? dottedName(fn) : null;
    if (name === null) return null;
    const args = argumentsOf(call);
    const [head = name, ...rest] = name.split(".");
    const wrapper =
      rest.length === 0
        ? (wrappers.get(head) ?? imported(head).wrapper)
        : undefined;
    if (wrapper) {
      const { method } = wrapper;
      return {
        url: args[wrapper.param],
        before: wrapper.before,
        after: wrapper.after,
        base: wrapper.base,
        method:
          typeof method === "string" ? method : { options: args[method.param] },
        wrapper: true,
      };
    }
    // `fetch`, `axios`, `got`, or a client of the file or imported.
    const client = clients.get(head) ?? imported(head).client;
    const lib = isTopLevel(head) ? null : libOf(head);
    const isFetch =
      rest.length === 0 &&
      (aliases.has(head)
        ? lib === "node-fetch"
        : head === "fetch" && lib === "fetch");
    const verb =
      rest.length === 1 && HTTP_VERBS.has(rest[0] ?? "") ? rest[0] : undefined;
    const isClient =
      (client !== undefined || lib === "axios" || lib === "got") &&
      (rest.length === 0 || verb !== undefined);
    if (!isFetch && !isClient) return null;
    let url = args[0];
    let options = args[1];
    if (url?.type === "object") {
      options = url;
      url = propertyOf(url, "url") ?? undefined;
    }
    return {
      url,
      before: EMPTY,
      after: EMPTY,
      base: client ?? null,
      method: verb ? verb.toUpperCase() : { options },
      wrapper: false,
    };
  };

  // A wrapper may call another one: repeat until no function becomes a wrapper.
  // The request inside a wrapper stays where it is, when its URL has text.
  const functions = topFunctions(root);
  for (let changed = true; changed; ) {
    changed = false;
    for (const { name, fn } of functions) {
      if (wrappers.has(name)) continue;
      const params = paramsOf(fn);
      for (const call of fn.descendantsOfType("call_expression")) {
        const target = targetOf(call);
        const wrapper = target && wrapperFrom(target, params);
        if (wrapper) {
          wrappers.set(name, wrapper);
          changed = true;
          break;
        }
      }
    }
  }
  // Mounts: `app.use("/api", users)` (Express), `app.route("/api", users)` (Hono).
  const local: { child: string; parent: string; path: string }[] = [];
  for (const [child, { parent, path }] of routers) {
    if (parent !== null) local.push({ child, parent, path });
  }
  const isRouter = (name: string): boolean =>
    routers.has(name) ||
    local.some((m) => m.child === name) ||
    mountedFrom(name).length > 0 ||
    ROUTER.test(name.split(".").pop() ?? "");
  for (const call of root.descendantsOfType("call_expression")) {
    const fn = call.childForFieldName("function");
    const method = fn?.childForFieldName("property")?.text;
    const parent = fn?.childForFieldName("object");
    const args = argumentsOf(call);
    const path = stringValue(args[0] ?? null);
    const child = args[args.length - 1];
    if (
      fn?.type === "member_expression" &&
      (method === "use" || method === "route") &&
      parent?.type === "identifier" &&
      isRouter(parent.text) &&
      path?.startsWith("/") &&
      args.length >= 2 &&
      child?.type === "identifier"
    )
      local.push({ child: child.text, parent: parent.text, path });
  }
  const prefixesOf = (name: string, seen = new Set<string>()): string[] => {
    // A router made from another one (`app.basePath("/api")`) takes its path as a mount.
    const made = routers.get(name);
    const own = made?.parent === null ? made.path : "";
    if (seen.has(name)) return [own];
    const inner = new Set([...seen, name]);
    const outer = [
      ...local
        .filter((m) => m.child === name)
        .flatMap((m) =>
          prefixesOf(m.parent, inner).map((p) => joinPath(p, m.path)),
        ),
      ...mountedFrom(name),
    ];
    return [
      ...new Set(
        (outer.length > 0 ? outer : [""]).map((p) => joinPath(p, own)),
      ),
    ];
  };
  const mounts: HttpFacts["mounts"] = [];
  for (const m of local) {
    const binding = aliases.get(m.child);
    if (!binding || binding.kind === "namespace") continue;
    for (const p of prefixesOf(m.parent)) {
      mounts.push({
        prefix: joinPath(p, m.path),
        module: binding.module,
        imported: binding.imported ?? "default",
      });
    }
  }
  return {
    clients,
    wrappers,
    dataNames,
    targetOf,
    isRouter,
    prefixesOf,
    mounts,
  };
}

/** The HTTP facts of a file for the other files: its own text only, nothing imported followed. */
export function httpFactsOf(root: Node): HttpFacts {
  const top = allocateTopLevel(root);
  const { clients, wrappers, mounts } = scanHttp(
    root,
    importBindings(root),
    boundNames(root),
    (name) => top.topLevel.has(name),
    () => ({}),
    () => [],
  );
  return { clients: [...clients], wrappers: [...wrappers], mounts };
}

/** The first token of the text arguments that names a file, as written. */
function pathToken(args: Node[]): string | null {
  const strings = args.flatMap((arg) =>
    arg.type === "array" ? arg.namedChildren : [arg],
  );
  for (const arg of strings) {
    const text = textOf(arg);
    for (const token of text?.split(/\s+/) ?? []) {
      if (
        !token.includes(HOLE) &&
        !token.startsWith("-") &&
        PATH_TOKEN.test(token)
      ) {
        return token;
      }
    }
  }
  return null;
}

/** The offers and requests of one file, each pointing at the node and line that holds it. */
export function collectLinks(
  path: string,
  root: Node,
  graph: Graph,
  exports: ExportInfo,
  project: ProjectHttp | null = null,
): FileLinks {
  const prefix = fileId(path);
  const aliases = importBindings(root);
  const bound = boundNames(root);
  const top = allocateTopLevel(root);
  const localId = (name: string): NodeId | undefined => {
    const id = top.topLevel.get(name);
    return id === undefined ? undefined : childId(prefix, id);
  };
  const nodeAt = (line: number): NodeId =>
    innermost(graph.nodes, line)?.id ?? prefix;
  /** The library a name belongs to: its module when imported, else its own name when undeclared. */
  const libOf = (head: string): string | null => {
    const binding = aliases.get(head);
    if (binding) return moduleRoot(binding.module);
    return bound.has(head) ? null : head;
  };

  /** The client or wrapper another file of the project exports under an imported name. */
  const imported = (
    name: string,
  ): { client?: Read | undefined; wrapper?: Wrapper | undefined } => {
    const binding = aliases.get(name);
    if (project === null || !binding || binding.kind === "namespace") return {};
    const file = resolveModulePath(path, binding.module, project.index);
    if (file === null) return {};
    const local = project.index.modules
      .get(file)
      ?.exports.names.get(binding.imported ?? "default");
    const facts = project.facts.get(file);
    if (local === undefined || facts === undefined) return {};
    return {
      client: facts.clients.find(([n]) => n === local)?.[1],
      wrapper: facts.wrappers.find(([n]) => n === local)?.[1],
    };
  };
  /** The prefixes other files mount this file's routers under, by local name. */
  const mountedHere = new Map<string, string[]>();
  for (const [file, facts] of project?.facts ?? []) {
    for (const m of facts.mounts) {
      const local = exports.names.get(m.imported);
      if (
        local === undefined ||
        resolveModulePath(file, m.module, project?.index ?? new Map()) !== path
      )
        continue;
      mountedHere.set(local, [...(mountedHere.get(local) ?? []), m.prefix]);
    }
  }
  const http = scanHttp(
    root,
    aliases,
    bound,
    (name) => top.topLevel.has(name),
    imported,
    (name) => mountedHere.get(name) ?? [],
  );
  const { dataNames } = http;
  const isClient = (name: string): boolean =>
    http.clients.has(name) || imported(name).client !== undefined;
  const isHandler = (node: Node | undefined): boolean =>
    node !== undefined &&
    HANDLERS.has(node.type) &&
    !(node.type === "identifier" && dataNames.has(node.text));

  const offers: Offer[] = [];
  const requests: LinkRequest[] = [];
  const seenNames = new Set<string>();
  const calls = root
    .descendantsOfType("call_expression")
    .sort((a, b) => a.startIndex - b.startIndex);

  for (const call of calls) {
    const fn = call.childForFieldName("function");
    if (!fn) continue;
    const line = call.startPosition.row + 1;
    const args = argumentsOf(call);
    const name = dottedName(fn);

    // Offer: a route, `app.get("/x", handler)`.
    if (fn.type === "member_expression") {
      const verb = fn.childForFieldName("property")?.text ?? "";
      const receiver = fn.childForFieldName("object");
      const receiverName = receiver ? dottedName(receiver) : null;
      const route = stringValue(args[0] ?? null);
      if (
        ROUTE_VERBS.has(verb) &&
        receiverName !== null &&
        !isClient(receiverName) &&
        http.isRouter(receiverName) &&
        route?.startsWith("/") &&
        args.length >= 2 &&
        isHandler(args[args.length - 1])
      ) {
        const handler = args[args.length - 1];
        const handlerId =
          handler?.type === "identifier" ? localId(handler.text) : undefined;
        for (const routerPrefix of http.prefixesOf(receiverName)) {
          offers.push({
            channel: "http",
            key: `${verb === "all" ? "*" : verb.toUpperCase()} ${joinPath(routerPrefix, route)}`,
            nodeId: handlerId ?? nodeAt(line),
            line,
          });
        }
      }
    }
    if (name === null) continue;

    // Request: `fetch`, `axios`, `got`, a client, or a function that wraps one of them.
    const target = http.targetOf(call);
    const own = target?.url ? readPieces(piecesOf(target.url)) : null;
    if (target && own && (!target.wrapper || withText(own))) {
      const read = withText(concat(target.before, own, target.after));
      const url = urlOf(
        read && target.base ? joinBase(target.base, read) : read,
      );
      if (url !== null) {
        const method =
          typeof target.method === "string"
            ? target.method
            : methodOf(target.method.options);
        requests.push({
          channel: "http",
          key: `${method} ${url.path}`,
          nodeId: nodeAt(line),
          line,
          ...(url.dynamicBase ? { dynamicBase: url.dynamicBase } : {}),
        });
      }
    }
    const [head = name, ...rest] = name.split(".");
    if (top.topLevel.has(head)) continue;
    const binding = aliases.get(head);
    const lib = libOf(head);

    // Request: `child_process.exec("node b.ts")`.
    const processFn =
      binding?.kind === "named" && rest.length === 0
        ? binding.imported
        : rest.length === 1
          ? rest[0]
          : null;
    if (lib === "child_process" && PROCESS_CALLS.has(processFn ?? "")) {
      const target = pathToken(args);
      if (target !== null) {
        requests.push({
          channel: "process",
          key: target,
          nodeId: nodeAt(line),
          line,
        });
      }
    }

    // Request: a plain name the file neither defines nor imports.
    if (
      fn.type === "identifier" &&
      !bound.has(name) &&
      !AMBIENT.has(name) &&
      classify(name) === "EXTERNO"
    ) {
      const nodeId = nodeAt(line);
      if (!seenNames.has(`${name}|${nodeId}`)) {
        seenNames.add(`${name}|${nodeId}`);
        requests.push({ channel: "name", key: name, nodeId, line });
      }
    }
  }

  // Offer: the file itself, for a process that runs it.
  offers.push({ channel: "process", key: path, nodeId: prefix, line: 1 });
  // Offer: each exported top-level function, by its exported name.
  for (const [exported, local] of exports.names) {
    const id = localId(local);
    const node = graph.nodes.find((n) => n.id === id);
    if (exported === "default" || node?.kind !== "function") continue;
    offers.push({
      channel: "name",
      key: exported,
      nodeId: node.id,
      line: node.range.start,
    });
  }
  return { offers, requests };
}
