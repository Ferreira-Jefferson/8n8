import type { FlowNode, NodeId } from "@8n8/model";
import { useEffect, useRef, useState } from "react";
import { type ExplainOrigin, fetchTitles } from "../api";

const NO_TITLES: ReadonlyMap<NodeId, string> = new Map();

/** Folders and files (`dir:`, `file:`) keep their own names; the server drops them anyway. */
function wantsTitle(node: FlowNode): boolean {
  return node.kind !== "folder" && node.kind !== "file";
}

/**
 * The reviewed titles of the map: one request per level, only for the IDs not
 * asked yet in this map version. A title for an ID not asked for is ignored, and
 * an answer for an old map version is dropped (VID-14, 15).
 */
export function useTitles(
  origin: ExplainOrigin | null,
  mapVersion: number,
  // SPEC_DEVIATION: the level's nodes, not only their IDs (C14).
  // Reason: a function of a project file has an ID that starts with `file:` too; the kind tells them apart.
  levelNodes: readonly FlowNode[],
): ReadonlyMap<NodeId, string> {
  const [state, setState] = useState({
    version: mapVersion,
    titles: NO_TITLES,
  });
  const asked = useRef({ version: mapVersion, ids: new Set<NodeId>() });
  const current = useRef(mapVersion);
  current.current = mapVersion;
  const idsKey = levelNodes.map((n) => n.id).join("\n");
  const originKey = JSON.stringify(origin);

  // biome-ignore lint/correctness/useExhaustiveDependencies: idsKey stands for levelNodes and originKey for origin
  useEffect(() => {
    if (asked.current.version !== mapVersion) {
      asked.current = { version: mapVersion, ids: new Set() };
    }
    if (origin === null) return;
    const pending = levelNodes
      .filter((n) => wantsTitle(n) && !asked.current.ids.has(n.id))
      .map((n) => n.id);
    if (pending.length === 0) return;
    for (const id of pending) asked.current.ids.add(id);
    const requested = new Set(pending);
    fetchTitles(origin, pending).then((titles) => {
      if (current.current !== mapVersion) return;
      setState((prev) => {
        const next = new Map(
          prev.version === mapVersion ? prev.titles : NO_TITLES,
        );
        for (const t of titles) {
          if (requested.has(t.nodeId)) next.set(t.nodeId, t.text);
        }
        return { version: mapVersion, titles: next };
      });
    });
  }, [mapVersion, idsKey, originKey]);

  return state.version === mapVersion ? state.titles : NO_TITLES;
}
