import type { Linker } from "./types";

const ANY = "*";
const PARAM = /^(:.+|\{.+\}|<.+>)$/;

interface Route {
  method: string;
  segments: string[];
}

/** `METHOD /path` or a bare URL/path (method `*`). Scheme, host, port, query and fragment are dropped. */
function parseRoute(key: string): Route {
  const text = key.trim();
  const space = text.search(/\s/);
  let method = ANY;
  let url = text;
  if (space > 0 && /^([A-Za-z]+|\*)$/.test(text.slice(0, space))) {
    method = text.slice(0, space).toUpperCase();
    url = text.slice(space).trim();
  }
  url = url.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/, "");
  url = url.replace(/[?#].*$/, "");
  const segments = url.split("/").filter((s) => s !== "");
  return { method, segments };
}

function sameSegment(a: string, b: string): boolean {
  return a === b || PARAM.test(a) || PARAM.test(b);
}

function matchRoutes(a: Route, b: Route): boolean {
  if (a.method !== ANY && b.method !== ANY && a.method !== b.method) {
    return false;
  }
  return (
    a.segments.length === b.segments.length &&
    a.segments.every((s, i) => sameSegment(s, b.segments[i] as string))
  );
}

/** How many segments of a request are literal and meet the same literal in the route. */
function literalHits(request: Route, offer: Route): number {
  return request.segments.filter(
    (s, i) => !PARAM.test(s) && s === offer.segments[i],
  ).length;
}

/** Whether a literal segment of a request meets only a parameter of the route: `/metrics` and `/{slug}`. */
function onParam(request: Route, offer: Route): boolean {
  return request.segments.some(
    (s, i) => !PARAM.test(s) && PARAM.test(offer.segments[i] as string),
  );
}

export const httpLinker: Linker = {
  channel: "http",
  sameLanguage: true,
  matches: (request, offer) =>
    matchRoutes(parseRoute(request.key), parseRoute(offer.key)),
  // Two routes match only with the same number of segments.
  offerKeys: (offer) => [String(parseRoute(offer.key).segments.length)],
  requestKeys: (request) => [String(parseRoute(request.key).segments.length)],
  // A literal route that matches beats one that matches by a parameter: `/users/me` over `/users/{id}`.
  narrow(request, offers) {
    const r = parseRoute(request.key);
    const hits = offers.map((o) => literalHits(r, parseRoute(o.key)));
    const best = Math.max(...hits);
    return offers.filter((_, i) => hits[i] === best);
  },
  doubt: (request, offer) =>
    onParam(parseRoute(request.key), parseRoute(offer.key))
      ? "param-route"
      : undefined,
  label(request, offer) {
    const r = parseRoute(request.key);
    const method = r.method === ANY ? parseRoute(offer.key).method : r.method;
    return `HTTP ${method} /${r.segments.join("/")}`;
  },
};
