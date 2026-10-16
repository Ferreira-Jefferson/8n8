import type { EdgeKind } from "@8n8/model";

/** The wires that say one node depends on another: calls, inherits and imports. They draw with a hollow end and a pattern of their own. */
export function isDependency(kind: EdgeKind): boolean {
  return kind === "calls" || kind === "extends" || kind === "imports";
}
