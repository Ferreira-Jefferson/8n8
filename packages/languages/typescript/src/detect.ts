import { parsers } from "./parse";

/** A form of the language. Each matching line counts, up to `cap` lines. */
interface Signal {
  pattern: RegExp;
  weight: number;
  cap: number;
}

/** Reserved words and shapes that only TypeScript (or JavaScript) writes. */
const TYPESCRIPT: Signal[] = [
  {
    pattern: /^\s*import\s+(?:type\s+)?[\w${}*\s,]+\s+from\s+["']/,
    weight: 3,
    cap: 2,
  },
  { pattern: /^\s*import\s+["']/, weight: 2, cap: 1 },
  {
    pattern:
      /^\s*export\s+(?:default|const|let|var|function|class|interface|type|async|enum|abstract|\{|\*)/,
    weight: 3,
    cap: 2,
  },
  { pattern: /\bfunction\s*\*?\s*[\w$]*\s*\(/, weight: 2.5, cap: 2 },
  {
    pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+[\w${[]/,
    weight: 1.5,
    cap: 3,
  },
  { pattern: /=>/, weight: 1.5, cap: 2 },
  {
    pattern: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+\w+/,
    weight: 3,
    cap: 1,
  },
  {
    pattern: /^\s*(?:export\s+)?type\s+\w+(?:<[^>]*>)?\s*=/,
    weight: 3,
    cap: 1,
  },
  // `(peso: number, ...)`: a type after a parameter name.
  {
    pattern: /[(,]\s*[\w$]+\??\s*:\s*[\w$.<>[\]|{} ]+\s*[,)=]/,
    weight: 2,
    cap: 2,
  },
  // `): string {`: a return type before the body.
  {
    pattern: /\)\s*:\s*[\w$<>[\]| ]+\s*(?:\{|=>)/,
    weight: 2.5,
    cap: 1,
  },
  {
    pattern: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+\w+[^:\n]*\{\s*$/,
    weight: 2.5,
    cap: 1,
  },
  { pattern: /\bconsole\.\w+\(/, weight: 2, cap: 1 },
  { pattern: /\brequire\(/, weight: 2, cap: 1 },
  { pattern: /[!=]==/, weight: 2, cap: 1 },
  { pattern: /\bnew\s+[A-Z]\w*\(/, weight: 1, cap: 1 },
  { pattern: /`[^`]*\$\{/, weight: 2, cap: 1 },
  { pattern: /;\s*$/, weight: 0.7, cap: 4 },
  { pattern: /\{\s*$/, weight: 0.5, cap: 3 },
  { pattern: /^\s*\}[\s;,)]*$/, weight: 0.5, cap: 2 },
  { pattern: /^\s*\/[/*]/, weight: 1, cap: 1 },
];

/** What Python writes and TypeScript does not. */
const PYTHON: Signal[] = [
  { pattern: /^\s*def\s+\w+\s*\(/, weight: 4, cap: 2 },
  { pattern: /^\s*elif\b/, weight: 4, cap: 1 },
  {
    pattern:
      /^\s*(?:if|for|while|else|try|with|class|def|elif|except|finally|match)\b[^{;]*:\s*(?:#.*)?$/,
    weight: 3,
    cap: 2,
  },
  {
    pattern:
      /^\s*(?:from\s+[\w.]+\s+import\s+|import\s+[\w.]+(?:\s+as\s+\w+)?\s*$)/,
    weight: 3,
    cap: 1,
  },
  { pattern: /\bself\b/, weight: 2, cap: 1 },
  { pattern: /\bprint\(/, weight: 1.5, cap: 1 },
  { pattern: /\b(?:None|True|False)\b/, weight: 2, cap: 1 },
  { pattern: /\blambda\b/, weight: 2, cap: 1 },
  { pattern: /^\s*#\s/, weight: 1.5, cap: 1 },
];

function points(signals: Signal[], lines: string[]): number {
  let total = 0;
  for (const { pattern, weight, cap } of signals) {
    const count = lines.filter((line) => pattern.test(line)).length;
    total += weight * Math.min(count, cap);
  }
  return total;
}

/** True when neither grammar reads the text without a syntax error. */
function hasSyntaxError(source: string): boolean {
  for (const parser of [parsers.typescript, parsers.tsx]) {
    const tree = parser.parse(source);
    const clean = tree !== null && !tree.rootNode.hasError;
    tree?.delete();
    if (clean) return false;
  }
  return true;
}

/**
 * How much the text looks like TypeScript, from 0 to 1. The shapes of the
 * language add points, the shapes of Python take them away, and a text that
 * no grammar reads clean loses half. One ambiguous line (`x = 1`) scores 0.
 */
export function detectTypescript(source: string): number {
  if (source.trim() === "") return 0;
  const lines = source.split(/\r?\n/);
  const raw = Math.max(0, points(TYPESCRIPT, lines) - points(PYTHON, lines));
  const score = raw / (raw + 4);
  const adjusted = hasSyntaxError(source) ? score / 2 : score;
  return Math.round(adjusted * 10_000) / 10_000;
}
