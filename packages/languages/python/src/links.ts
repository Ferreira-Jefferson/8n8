import {
  type FlowNode,
  fileId,
  type LinkRequest,
  type Offer,
} from "@code2n8n/model";
import type { Node } from "web-tree-sitter";
import { boundNames } from "./bound";
import { dottedName } from "./calls";
import { importAliases } from "./imports";

/** What a file offers and asks for, for the project to match (D4). */
export interface FileLinks {
  offers: Offer[];
  requests: LinkRequest[];
}

const VERBS = new Set([
  "get",
  "post",
  "put",
  "delete",
  "patch",
  "head",
  "options",
]);
const HTTP_MODULES = new Set(["requests", "httpx", "aiohttp"]);
const URLLIB_CALLS = new Set(["urlopen", "Request", "urlretrieve"]);
const PROCESS_CALLS = new Set([
  "subprocess.run",
  "subprocess.call",
  "subprocess.Popen",
  "subprocess.check_call",
  "subprocess.check_output",
  "os.system",
]);
/** Flask and FastAPI decorators that take a path and a list of methods. */
const ROUTE_DECORATORS = new Set(["route", "api_route"]);

/** Names Python gives every file; a call to one is not a call to another file. */
const BUILTINS = new Set([
  "abs",
  "all",
  "any",
  "ascii",
  "bin",
  "bool",
  "breakpoint",
  "bytearray",
  "bytes",
  "callable",
  "chr",
  "classmethod",
  "compile",
  "complex",
  "delattr",
  "dict",
  "dir",
  "divmod",
  "enumerate",
  "eval",
  "exec",
  "filter",
  "float",
  "format",
  "frozenset",
  "getattr",
  "globals",
  "hasattr",
  "hash",
  "help",
  "hex",
  "id",
  "input",
  "int",
  "isinstance",
  "issubclass",
  "iter",
  "len",
  "list",
  "locals",
  "map",
  "max",
  "memoryview",
  "min",
  "next",
  "object",
  "oct",
  "open",
  "ord",
  "pow",
  "print",
  "property",
  "range",
  "repr",
  "reversed",
  "round",
  "set",
  "setattr",
  "slice",
  "sorted",
  "staticmethod",
  "str",
  "sum",
  "super",
  "tuple",
  "type",
  "vars",
  "zip",
  "__import__",
]);

/** The text of a plain string literal, or null for f-strings with fields, bytes and other expressions. */
function stringValue(node: Node | null | undefined): string | null {
  if (node?.type !== "string") return null;
  const match = /^([A-Za-z]*)("""|'''|"|')([\s\S]*)\2$/.exec(node.text);
  const prefix = match?.[1]?.toLowerCase() ?? "";
  const body = match?.[3];
  if (body === undefined || prefix.includes("b")) return null;
  if (prefix.includes("f") && body.includes("{")) return null;
  return body;
}

/** Arguments of a call that are not comments, in order. */
function argumentsOf(call: Node): Node[] {
  const list = call.childForFieldName("arguments");
  return (list?.namedChildren ?? []).filter((n) => n.type !== "comment");
}

/** The first positional argument of a call. */
function firstArgument(call: Node): Node | undefined {
  return argumentsOf(call).find((n) => n.type !== "keyword_argument");
}

/** The dotted name called by `call`, with the import aliases replaced. */
function calledName(call: Node, aliases: Map<string, string>): string | null {
  const fn = call.childForFieldName("function");
  const name = fn ? dottedName(fn) : null;
  if (name === null) return null;
  const [head = name, ...rest] = name.split(".");
  const imported = aliases.get(head);
  return imported === undefined ? name : [imported, ...rest].join(".");
}

/** `/frete` from `https://api.x.com/frete?a=1`, or from a path that starts with `/`; null otherwise. */
function pathOfUrl(url: string): string | null {
  const absolute = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(url);
  if (absolute) return absolute[1] ?? "/";
  return url.startsWith("/") ? (url.split(/[?#]/)[0] ?? null) : null;
}

/** A word that looks like the path of a file: `b.ts`, `./run.sh`, `scripts/a.py`. */
function isFilePath(word: string): boolean {
  return /^[\w./\\-]*[\w-]\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(word);
}

/** The words of the command: one string, or the strings of a list or tuple. */
function commandWords(arg: Node | undefined): string[] {
  if (arg === undefined) return [];
  const parts =
    arg.type === "list" || arg.type === "tuple" ? arg.namedChildren : [arg];
  return parts.flatMap((part) => (stringValue(part) ?? "").split(/\s+/));
}

/** The smallest node that holds `line`; among equals, the one that comes last (the deepest). */
function nodeAt(
  nodes: FlowNode[],
  line: number,
  accepts: (node: FlowNode) => boolean = () => true,
): FlowNode | undefined {
  let best: FlowNode | undefined;
  for (const node of nodes) {
    const { start, end } = node.range;
    if (!accepts(node) || line < start || line > end) continue;
    if (!best || end - start <= best.range.end - best.range.start) best = node;
  }
  return best;
}

function httpRequest(name: string, call: Node): string | null {
  const segments = name.split(".");
  const first = segments[0] ?? "";
  const last = segments[segments.length - 1] ?? "";
  let method: string;
  if (segments.length === 2 && HTTP_MODULES.has(first) && VERBS.has(last)) {
    method = last.toUpperCase();
  } else if (first === "urllib" && URLLIB_CALLS.has(last)) {
    method = "*";
  } else {
    return null;
  }
  const path = pathOfUrl(stringValue(firstArgument(call)) ?? "");
  return path === null ? null : `${method} ${path}`;
}

/** Requests of a file: HTTP calls, processes that cite a path, calls to names the file does not define. */
function requestsOf(
  path: string,
  root: Node,
  nodes: FlowNode[],
): LinkRequest[] {
  const aliases = importAliases(root);
  const bound = boundNames(root);
  const requests: LinkRequest[] = [];
  const calls = root
    .descendantsOfType("call")
    .sort((a, b) => a.startIndex - b.startIndex);
  for (const call of calls) {
    const line = call.startPosition.row + 1;
    // The file node holds every line, so the fallback is only a guard.
    const owner = nodeAt(nodes, line)?.id ?? fileId(path);
    const add = (channel: LinkRequest["channel"], key: string) =>
      requests.push({ channel, key, nodeId: owner, line });

    const name = calledName(call, aliases);
    if (name === null) continue;
    const http = httpRequest(name, call);
    if (http !== null) add("http", http);
    if (PROCESS_CALLS.has(name)) {
      const paths = commandWords(firstArgument(call)).filter(isFilePath);
      for (const path of new Set(paths)) add("process", path);
    }
    const fn = call.childForFieldName("function");
    if (
      fn?.type === "identifier" &&
      !bound.has(fn.text) &&
      !aliases.has(fn.text) &&
      !BUILTINS.has(fn.text)
    ) {
      add("name", fn.text);
    }
  }
  return requests;
}

/** `GET /x` for each method of a route decorator, or an empty list for any other decorator. */
function routeKeys(decorator: Node): string[] {
  const call = decorator.namedChildren.find((n) => n.type === "call");
  const fn = call?.childForFieldName("function");
  const name = fn ? dottedName(fn) : null;
  const verb = name?.split(".").slice(1).pop();
  if (!call || verb === undefined) return [];
  const path = stringValue(firstArgument(call));
  if (path === null || !path.startsWith("/")) return [];
  if (VERBS.has(verb)) return [`${verb.toUpperCase()} ${path}`];
  if (!ROUTE_DECORATORS.has(verb)) return [];
  const methods = argumentsOf(call)
    .find(
      (n) =>
        n.type === "keyword_argument" &&
        n.childForFieldName("name")?.text === "methods",
    )
    ?.childForFieldName("value");
  const listed = (methods?.namedChildren ?? []).flatMap((m) => {
    const method = stringValue(m);
    return method === null ? [] : [method.toUpperCase()];
  });
  return (listed.length > 0 ? listed : ["GET"]).map((m) => `${m} ${path}`);
}

/** Offers of a file: routes, the file's own path, and its top-level functions. */
function offersOf(path: string, root: Node, nodes: FlowNode[]): Offer[] {
  const file = fileId(path);
  const offers: Offer[] = [
    { channel: "process", key: path, nodeId: file, line: 1 },
  ];
  for (const decorated of root.descendantsOfType("decorated_definition")) {
    const def = decorated.childForFieldName("definition");
    if (def?.type !== "function_definition") continue;
    const owner = nodeAt(
      nodes,
      def.startPosition.row + 1,
      (n) => n.kind === "function",
    );
    if (owner === undefined) continue;
    for (const decorator of decorated.namedChildren) {
      if (decorator.type !== "decorator") continue;
      for (const key of routeKeys(decorator)) {
        offers.push({
          channel: "http",
          key,
          nodeId: owner.id,
          line: decorator.startPosition.row + 1,
        });
      }
    }
  }
  for (const node of nodes) {
    if (node.kind === "function" && node.parentId === file) {
      offers.push({
        channel: "name",
        key: node.label,
        nodeId: node.id,
        line: node.range.start,
      });
    }
  }
  return offers;
}

/** Offers and requests of one parsed file; `nodes` is its graph (the file node first). */
export function collectLinks(
  path: string,
  root: Node,
  nodes: FlowNode[],
): FileLinks {
  return {
    offers: offersOf(path, root, nodes),
    requests: requestsOf(path, root, nodes),
  };
}
