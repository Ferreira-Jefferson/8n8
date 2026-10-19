import {
  type FlowEdge,
  joinWire,
  type LinkRequest,
  type Offer,
  type ToCheck,
} from "@8n8/model";
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

/**
 * The offers a request can match, in the order of `offers`. A linker with keys looks them up by key instead of
 * trying every offer; the same offers pass `matches` either way, in the same order.
 */
function indexOffers(
  linker: Linker,
  offers: Offer[],
): (request: LinkRequest, ctx: LinkContext) => Iterable<Offer> {
  const { offerKeys, requestKeys } = linker;
  if (!offerKeys || !requestKeys) return () => offers;
  const byKey = new Map<string, number[]>();
  offers.forEach((offer, i) => {
    for (const key of new Set(offerKeys(offer))) {
      const found = byKey.get(key);
      if (found) found.push(i);
      else byKey.set(key, [i]);
    }
  });
  return (request, ctx) => {
    const places = new Set<number>();
    for (const key of requestKeys(request, ctx)) {
      for (const i of byKey.get(key) ?? []) places.add(i);
    }
    return [...places].sort((a, b) => a - b).map((i) => offers[i] as Offer);
  };
}

/** An ambiguous request draws a wire to check to its first targets, at most this many. */
export const MAX_AMBIGUOUS_WIRES = 3;

/**
 * Turns the offers a request matches into wires, in `edges`; false when it matches none.
 * One offer: one wire, to check when the base of its URL is known only at run time or when the linker doubts it.
 * More than one: the request goes to `ambiguous`, with a wire to check to each of the first ones.
 */
export function settle(
  linker: Linker,
  request: LinkRequest,
  matched: Offer[],
  ctx: LinkContext,
  edges: Map<string, FlowEdge>,
  ambiguous: AmbiguousRequest[],
): boolean {
  const narrowed = linker.narrow ? linker.narrow(request, matched) : matched;
  // One offer per target node, the first one.
  const candidates = narrowed.filter(
    (o, i) => narrowed.findIndex((c) => c.nodeId === o.nodeId) === i,
  );
  if (candidates.length === 0) return false;
  const where = {
    path: ctx.fileOf(request.nodeId)?.path ?? "",
    line: request.line,
  };
  if (candidates.length > 1) ambiguous.push({ request, candidates });
  for (const offer of candidates.slice(0, MAX_AMBIGUOUS_WIRES)) {
    const reason = linker.doubt?.(request, offer);
    const toCheck: ToCheck | undefined =
      candidates.length > 1
        ? { reason: "ambiguous", targets: candidates.length, ...where }
        : request.dynamicBase !== undefined
          ? { reason: "dynamic-base", code: request.dynamicBase, ...where }
          : reason
            ? { reason, ...where }
            : undefined;
    const id = `link:${request.channel}:${request.nodeId}->${offer.nodeId}`;
    const wire: FlowEdge = {
      id,
      kind: "calls",
      source: request.nodeId,
      target: offer.nodeId,
      label: linker.label(request, offer),
      ...(linker.labelKey ? { labelKey: linker.labelKey } : {}),
      ...(toCheck ? { toCheck } : {}),
    };
    // Two calls of one node join on one wire, which counts the links of both.
    const known = edges.get(id);
    if (known) joinWire(known, wire);
    else edges.set(id, wire);
  }
  return true;
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
    const keyed = indexOffers(linker, offers);
    const linkedHere: string[] = [];
    for (const request of requests) {
      if (request.channel !== linker.channel) continue;
      if (linkedNodes.has(request.nodeId)) continue;
      const candidates: Offer[] = [];
      for (const offer of keyed(request, ctx)) {
        if (offer.nodeId === request.nodeId) continue;
        if (
          !linker.sameLanguage &&
          isSameSide(ctx, request.nodeId, offer.nodeId)
        ) {
          continue;
        }
        if (!linker.matches(request, offer, ctx)) continue;
        candidates.push(offer);
      }
      if (settle(linker, request, candidates, ctx, edges, ambiguous)) {
        linkedHere.push(request.nodeId);
      } else unlinked.push(request);
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
