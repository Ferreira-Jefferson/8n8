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
import { argumentsOf, importBindings, stringValue } from "./imports";
import type { ExportInfo } from "./modules";

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

/**
 * The text of a string-like expression, with `HOLE` where the value is not
 * known, and the code of each hole in order; null when no part of it is text.
 */
function readText(node: Node | null): { text: string; holes: string[] } | null {
  const holes: string[] = [];
  const hole = (code: Node): string => {
    holes.push(code.text.replace(/\s+/g, " "));
    return HOLE;
  };
  const parts = (n: Node): string => {
    switch (n.type) {
      case "string":
        return n.text.slice(1, -1);
      case "template_string":
        return n.children
          .map((c) =>
            c.type === "template_substitution"
              ? hole(c.namedChildren[0] ?? c)
              : c.isNamed
                ? c.text
                : "",
          )
          .join("");
      case "parenthesized_expression":
        return n.namedChildren[0] ? parts(n.namedChildren[0]) : hole(n);
      case "binary_expression": {
        const left = n.childForFieldName("left");
        const right = n.childForFieldName("right");
        return n.childForFieldName("operator")?.text === "+" && left && right
          ? parts(left) + parts(right)
          : hole(n);
      }
      default:
        return hole(n);
    }
  };
  if (node === null) return null;
  const text = parts(node);
  return text.replaceAll(HOLE, "") === "" ? null : { text, holes };
}

function textOf(node: Node | null): string | null {
  return readText(node)?.text ?? null;
}

/**
 * The path of a URL (`https://h/api/x?q=1` → `/api/x`); `:param` for a hole. Null if not a path.
 * `dynamicBase` is the code of the value the URL starts with, or of its host, when the code decides it at run
 * time (`${config.baseUrl}/users`): the path may belong to another service.
 */
function urlOf(
  node: Node | null,
): { path: string; dynamicBase?: string } | null {
  const read = readText(node);
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

  /** Names bound to a client (`const api = axios.create(...)`), and names bound to data. */
  const clients = new Set<string>();
  const dataNames = new Set<string>();
  for (const declarator of root.descendantsOfType("variable_declarator")) {
    const name = declarator.childForFieldName("name");
    const value = declarator.childForFieldName("value");
    if (name?.type !== "identifier" || !value) continue;
    if (DATA.has(value.type)) dataNames.add(name.text);
    const factory =
      value.type === "call_expression"
        ? value.childForFieldName("function")
        : null;
    const [head = "", method = "", ...more] =
      (factory ? dottedName(factory)?.split(".") : undefined) ?? [];
    const lib = head === "" ? null : libOf(head);
    if (more.length === 0 && CLIENT_FACTORIES.get(lib ?? "")?.has(method)) {
      clients.add(name.text);
    }
  }
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
        !clients.has(receiverName) &&
        ROUTER.test(receiverName.split(".").pop() ?? "") &&
        route?.startsWith("/") &&
        args.length >= 2 &&
        isHandler(args[args.length - 1])
      ) {
        const handler = args[args.length - 1];
        const handlerId =
          handler?.type === "identifier" ? localId(handler.text) : undefined;
        offers.push({
          channel: "http",
          key: `${verb === "all" ? "*" : verb.toUpperCase()} ${route}`,
          nodeId: handlerId ?? nodeAt(line),
          line,
        });
      }
    }
    if (name === null) continue;
    const [head = name, ...rest] = name.split(".");
    if (top.topLevel.has(head)) continue;
    const binding = aliases.get(head);
    const lib = libOf(head);

    // Request: `fetch`, `axios`, `got`.
    const isFetch =
      rest.length === 0 &&
      (binding ? lib === "node-fetch" : head === "fetch" && lib === "fetch");
    const verb =
      rest.length === 1 && HTTP_VERBS.has(rest[0] ?? "") ? rest[0] : undefined;
    const isClient =
      (lib === "axios" || lib === "got") && (rest.length === 0 || verb);
    if (isFetch || isClient) {
      let urlNode = args[0];
      let options = args[1];
      if (urlNode?.type === "object") {
        options = urlNode;
        urlNode = propertyOf(urlNode, "url") ?? undefined;
      }
      const url = urlOf(urlNode ?? null);
      if (url !== null) {
        const method = verb ? verb.toUpperCase() : methodOf(options);
        requests.push({
          channel: "http",
          key: `${method} ${url.path}`,
          nodeId: nodeAt(line),
          line,
          ...(url.dynamicBase ? { dynamicBase: url.dynamicBase } : {}),
        });
      }
    }

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
