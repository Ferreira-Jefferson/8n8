import type {
  FlowNode,
  LinkChannel,
  LinkRequest,
  Offer,
} from "@code2n8n/model";
import type { LinkContext } from "../types";

export function fileNode(path: string): FlowNode {
  return {
    id: `file:${path}`,
    kind: "file",
    label: path,
    parentId: null,
    range: { start: 1, end: 1 },
    openable: true,
    path,
  };
}

/** A node inside a file; its id is `file:<path>/<name>`. */
export function innerNode(path: string, name: string): FlowNode {
  return {
    id: `file:${path}/${name}`,
    kind: "function",
    label: name,
    parentId: `file:${path}`,
    range: { start: 1, end: 1 },
    openable: true,
  };
}

export function nodeId(path: string, name: string): string {
  return `file:${path}/${name}`;
}

export function offer(
  channel: LinkChannel,
  key: string,
  path: string,
  name: string,
  line = 1,
): Offer {
  return { channel, key, nodeId: nodeId(path, name), line };
}

export function request(
  channel: LinkChannel,
  key: string,
  path: string,
  name: string,
  line = 1,
): LinkRequest {
  return { channel, key, nodeId: nodeId(path, name), line };
}

/** Context over a map node id -> file path. */
export function contextOf(files: Record<string, string>): LinkContext {
  return {
    fileOf: (id) => {
      const path = files[id];
      if (path === undefined) return undefined;
      const dot = path.lastIndexOf(".");
      return { path, language: dot < 0 ? "" : path.slice(dot) };
    },
  };
}
