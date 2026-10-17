import type {
  EdgeLabelKey,
  FlowEdge,
  FlowNode,
  LinkChannel,
  LinkRequest,
  Offer,
} from "@8n8/model";

/** Where a node lives: its file path (POSIX, relative to the root) and its language. */
export interface FileInfo {
  path: string;
  /** Lowercase extension with the dot (`.py`); `""` without one. Stands for the language. */
  language: string;
}

export interface LinkContext {
  /** The file that holds a node, or undefined when the node has no `file` ancestor. */
  fileOf(nodeId: string): FileInfo | undefined;
}

/** One channel. The core knows nothing else about it: it asks only if a request matches an offer. */
export interface Linker {
  channel: LinkChannel;
  /** Whether a request may link to an offer written in the same language (and file). */
  sameLanguage: boolean;
  matches(request: LinkRequest, offer: Offer, ctx: LinkContext): boolean;
  /**
   * Optional, only to go faster, with `requestKeys`: `matches` is true only for a request and an offer that share a key.
   * Without both, every offer is tried for every request.
   */
  offerKeys?(offer: Offer): string[];
  requestKeys?(request: LinkRequest, ctx: LinkContext): string[];
  /** Text of the wire, e.g. `HTTP POST /api/frete`. */
  label(request: LinkRequest, offer: Offer): string;
  /** Set when the system, not the code, writes the text: the screen says the key in the language of the system. */
  labelKey?: EdgeLabelKey;
}

export interface LinkInput {
  offers: Offer[];
  requests: LinkRequest[];
  /** Nodes of the graph, to find the file and language of every node. */
  nodes: FlowNode[];
}

export interface AmbiguousRequest {
  request: LinkRequest;
  /** The offers that match, one per target node, in a fixed order. */
  candidates: Offer[];
}

export interface LinkResult {
  edges: FlowEdge[];
  /** No offer matches: the request stays as an `external` node. */
  unlinked: LinkRequest[];
  /** More than one offer matches: nothing is linked. */
  ambiguous: AmbiguousRequest[];
}
