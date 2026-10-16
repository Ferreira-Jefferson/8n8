import type { ExternalCategory, FlowNode, Graph } from "@8n8/model";
import { defaultT, type MessageKey, type Translate } from "../i18n";

const CODE_LINE_MAX = 32;

const CATEGORY_TAG: Record<ExternalCategory, string> = {
  HTTP: "HTTP",
  BANCO: "BANCO",
  ARQUIVO: "DISCO",
  EMAIL: "E-MAIL",
  EXTERNO: "EXTERNO",
};

/** The label shown for an external category, on the card and in the panel (VID-04). */
export function categoryTag(category: ExternalCategory): string {
  return CATEGORY_TAG[category];
}

/** The text of a tag in the chosen language; the tag itself (`tagOf`) stays the stable id that styles and tests read. */
export function tagLabel(tag: string, t: Translate = defaultT): string {
  return t(`tag.${tag}` as MessageKey);
}

/** The tag line of a card (VID-04). */
export function tagOf(node: FlowNode): string {
  switch (node.kind) {
    case "function":
    case "class":
    case "call":
      return "FUNÇÃO";
    case "external":
      return categoryTag(node.category ?? "EXTERNO");
    case "condition":
      return "SE";
    case "loop":
      return "LAÇO";
    case "block":
      return "BLOCO";
    case "code":
      return "CÓDIGO";
    case "return":
      return "RETORNO";
    case "folder":
      return "PASTA";
    case "file":
      return "ARQUIVO";
    case "module":
      return "CÓDIGO SOLTO";
  }
}

/** The deterministic name shown while there is no reviewed title (VID-15). */
export function provisionalLabel(
  node: FlowNode,
  t: Translate = defaultT,
): string {
  switch (node.kind) {
    case "function":
    case "class":
    case "call":
    case "external": {
      const words = (node.label.split(".").at(-1) ?? "").replaceAll("_", " ");
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
    case "code":
      return t("label.code");
    case "return":
      return t("label.return");
    case "module":
      return t("label.module");
    default:
      return node.label;
  }
}

/** The mono code line of a card (VID-03). */
export function codeLineOf(node: FlowNode, source: string): string {
  switch (node.kind) {
    case "function":
    case "class":
    case "call":
      return `${node.label}()`;
    case "external":
      return `${node.callee ?? node.label}()`;
    case "condition":
      return `if ${node.label}`;
    case "loop":
    case "block":
      return node.label;
    case "folder":
      return `${node.path ?? ""}/`;
    case "file":
      return node.path ?? node.label;
    default: {
      const lines = source.split("\n");
      const doc = node.docstring;
      let line = "";
      for (let n = node.range.start; n <= node.range.end; n++) {
        if (doc && n >= doc.start && n <= doc.end) continue;
        line = (lines[n - 1] ?? "").trim();
        if (line) break;
      }
      // Only a docstring (or blank): today's behaviour, the first line.
      if (!line) line = (lines[node.range.start - 1] ?? "").trim();
      return line.length > CODE_LINE_MAX
        ? `${line.slice(0, CODE_LINE_MAX - 1)}…`
        : line;
    }
  }
}

/**
 * Whether a click opens the node's inner flow (VID-24): the extractor's rule,
 * plus, for a container, having at least one child to show. An openable kind
 * with no inner node is a dead end: it stays a leaf (no `›`, a click selects it).
 */
export function isOpenable(node: FlowNode, graph: Graph): boolean {
  if (!node.openable) return false;
  // A call opens its target elsewhere, not inner children.
  if (node.kind === "call") return true;
  // A file of a skeleton is open when it has something inside: the server said so in `openable`, before its nodes load.
  if (node.kind === "file" && node.size !== undefined) return true;
  return graph.nodes.some((n) => n.parentId === node.id);
}
