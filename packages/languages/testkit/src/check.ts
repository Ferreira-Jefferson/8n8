import type {
  FlowNode,
  Graph,
  LanguageAnalysis,
  NodeId,
  SourceFile,
} from "@8n8/model";

/** Number of lines of a source, not counting the empty one after a final newline; at least 1. */
export function lineCount(source: string): number {
  const lines = source.split("\n").length - (source.endsWith("\n") ? 1 : 0);
  return Math.max(1, lines);
}

/** Whether a node must be openable (VID-24), or null when the rule does not say. */
function mustBeOpenable(node: FlowNode): boolean {
  switch (node.kind) {
    case "call":
      return node.target !== undefined;
    case "code":
    case "condition":
    case "external":
    case "return":
      return false;
    default:
      return true;
  }
}

/**
 * Problems in a graph: unique ids, pre-order, 1-based inclusive lines inside
 * `source`, and the `openable` rule. Empty list means the graph conforms.
 */
export function graphProblems(graph: Graph, source: string): string[] {
  const problems: string[] = [];
  const last = lineCount(source);
  const ids = new Set(graph.nodes.map((n) => n.id));
  const seen = new Set<NodeId>();
  let stack: NodeId[] = [];
  for (const node of graph.nodes) {
    if (seen.has(node.id)) problems.push(`duplicate node id ${node.id}`);
    seen.add(node.id);

    // Pre-order: the parent is the previous node or one of its ancestors.
    if (node.parentId !== null && ids.has(node.parentId)) {
      while (stack.length > 0 && stack[stack.length - 1] !== node.parentId) {
        stack.pop();
      }
      if (stack.length === 0) {
        problems.push(`node ${node.id} is not in pre-order`);
      }
    } else {
      stack = [];
    }
    stack.push(node.id);

    const { start, end } = node.range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1) {
      problems.push(`node ${node.id} has lines ${start}-${end}, not 1-based`);
    } else if (end < start || end > last) {
      problems.push(
        `node ${node.id} has lines ${start}-${end}, outside 1-${last}`,
      );
    }
    if (node.openable !== mustBeOpenable(node)) {
      problems.push(
        `node ${node.id} (${node.kind}) has openable ${node.openable}`,
      );
    }
  }
  return problems;
}

/** Problems in what `analyze` returned for `files`. Empty list means it conforms. */
export function analysisProblems(
  files: SourceFile[],
  analysis: LanguageAnalysis,
  pluginId: string,
): string[] {
  const problems: string[] = [];
  const sources = new Map(files.map((f) => [f.path, f.source]));
  const allIds = new Set<NodeId>();
  const returned = new Set<string>();
  for (const { path, graph } of analysis.files) {
    const source = sources.get(path);
    if (source === undefined) {
      problems.push(`${path}: a file that was not given`);
      continue;
    }
    returned.add(path);
    const head = graph.nodes[0];
    const prefix = `file:${path}`;
    if (head?.kind !== "file" || head.id !== prefix) {
      problems.push(`${path}: the first node must be the file node ${prefix}`);
    }
    for (const node of graph.nodes) {
      if (node.id !== prefix && !node.id.startsWith(`${prefix}/`)) {
        problems.push(`${path}: node ${node.id} does not start with ${prefix}`);
      }
      allIds.add(node.id);
    }
    if (graph.language !== pluginId) {
      problems.push(`${path}: graph language is ${graph.language}`);
    }
    problems.push(...graphProblems(graph, source).map((p) => `${path}: ${p}`));
  }
  for (const f of files) {
    if (!returned.has(f.path)) problems.push(`${f.path}: no graph returned`);
  }
  for (const edge of analysis.files.flatMap((f) => f.graph.edges)) {
    for (const end of [edge.source, edge.target]) {
      if (!allIds.has(end)) problems.push(`edge ${edge.id}: ${end} not found`);
    }
  }
  for (const edge of analysis.imports) {
    if (edge.kind !== "imports") {
      problems.push(`edge ${edge.id}: kind ${edge.kind} among the imports`);
    }
    for (const end of [edge.source, edge.target]) {
      if (!allIds.has(end)) problems.push(`edge ${edge.id}: ${end} not found`);
    }
  }
  for (const link of [...analysis.offers, ...analysis.requests]) {
    if (!allIds.has(link.nodeId)) {
      problems.push(`${link.channel} ${link.key}: ${link.nodeId} not found`);
    }
    if (!Number.isInteger(link.line) || link.line < 1) {
      problems.push(`${link.channel} ${link.key}: line ${link.line}`);
    }
  }
  return problems;
}
