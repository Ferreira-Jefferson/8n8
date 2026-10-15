import type { FlowEdge, LinkRequest, Offer } from "@8n8/model";
import { httpLinker } from "./http";
import { nameLinker } from "./name";
import { processLinker } from "./process";
import type {
  AmbiguousRequest,
  FileInfo,
  LinkContext,
  Linker,
  LinkInput,
  LinkResult,
} from "./types";

/** Most trusted first: a request linked by one channel skips the next ones. */
const LINKERS: Linker[] = [httpLinker, processLinker, nameLinker];

const cmp = (a: string | number, b: string | number) =>
  a < b ? -1 : a > b ? 1 : 0;

const byOffer = (a: Offer, b: Offer) =>
  cmp(a.nodeId, b.nodeId) || cmp(a.line, b.line) || cmp(a.key, b.key);

const byRequest = (a: LinkRequest, b: LinkRequest) =>
  cmp(a.channel, b.channel) ||
  cmp(a.nodeId, b.nodeId) ||
  cmp(a.line, b.line) ||
  cmp(a.key, b.key);

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

function buildContext(nodes: LinkInput["nodes"]): LinkContext {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const cache = new Map<string, FileInfo | undefined>();
  const fileOf = (id: string): FileInfo | undefined => {
    if (cache.has(id)) return cache.get(id);
    let node = byId.get(id);
    const seen = new Set<string>();
    let info: FileInfo | undefined;
    while (node && !seen.has(node.id)) {
      seen.add(node.id);
      if (node.kind === "file") {
        const path = node.path ?? "";
        info = { path, language: extensionOf(path) };
        break;
      }
      node = node.parentId === null ? undefined : byId.get(node.parentId);
    }
    cache.set(id, info);
    return info;
  };
  return { fileOf };
}

/** Same file or same language: only the channels with `sameLanguage` may link these. */
function isSameSide(ctx: LinkContext, a: string, b: string): boolean {
  const fa = ctx.fileOf(a);
  const fb = ctx.fileOf(b);
  if (!fa || !fb) return false;
  return fa.path === fb.path || fa.language === fb.language;
}

/** Matches requests to offers across languages and returns the wires, deterministically. */
export function linkProject(input: LinkInput): LinkResult {
  const ctx = buildContext(input.nodes);
  const requests = [...input.requests].sort(byRequest);
  const edges = new Map<string, FlowEdge>();
  const unlinked: LinkRequest[] = [];
  const ambiguous: AmbiguousRequest[] = [];
  /** Nodes that already have a wire from a more trusted channel. */
  const linkedNodes = new Set<string>();

  for (const linker of LINKERS) {
    const offers = input.offers
      .filter((o) => o.channel === linker.channel)
      .sort(byOffer);
    const linkedHere: string[] = [];
    for (const request of requests) {
      if (request.channel !== linker.channel) continue;
      if (linkedNodes.has(request.nodeId)) continue;
      const candidates: Offer[] = [];
      for (const offer of offers) {
        if (offer.nodeId === request.nodeId) continue;
        if (
          !linker.sameLanguage &&
          isSameSide(ctx, request.nodeId, offer.nodeId)
        ) {
          continue;
        }
        if (!linker.matches(request, offer, ctx)) continue;
        if (candidates.some((c) => c.nodeId === offer.nodeId)) continue;
        candidates.push(offer);
      }
      const [only, ...rest] = candidates;
      if (!only) unlinked.push(request);
      else if (rest.length > 0) ambiguous.push({ request, candidates });
      else {
        const id = `link:${request.channel}:${request.nodeId}->${only.nodeId}`;
        edges.set(id, {
          id,
          kind: "calls",
          source: request.nodeId,
          target: only.nodeId,
          label: linker.label(request, only),
        });
        linkedHere.push(request.nodeId);
      }
    }
    // Marked after the channel, so two requests of one node in the same channel both go through.
    for (const id of linkedHere) linkedNodes.add(id);
  }

  return {
    edges: [...edges.values()].sort((a, b) => cmp(a.id, b.id)),
    unlinked,
    ambiguous,
  };
}
