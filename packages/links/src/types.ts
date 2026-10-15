import type {
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
  /** Text of the wire, e.g. `HTTP POST /api/frete`. */
  label(request: LinkRequest, offer: Offer): string;
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
