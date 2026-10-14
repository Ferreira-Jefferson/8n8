/** A form that Python has and the other languages do not, with the weight it adds. */
const SIGNS: [RegExp, number][] = [
  [/^\s*(async\s+)?def\s+\w+\s*\(.*\)\s*(->\s*[^:]+)?:\s*(#.*)?$/, 3],
  [/^\s*class\s+\w+\s*(\(.*\))?\s*:\s*(#.*)?$/, 3],
  [/^\s*from\s+[\w.]+\s+import\s+[\w*(,\s]+$/, 3],
  [/^\s*import\s+[\w.]+(\s+as\s+\w+)?(\s*,\s*[\w.]+)*\s*$/, 2],
  [/^\s*elif\b.*:\s*$/, 3],
  [/^\s*(if|else|for|while|try|except|finally|with)\b.*:\s*(#.*)?$/, 2],
  [/^\s*@[\w.]+(\(.*\))?\s*$/, 1],
  [/\bself\b/, 1],
  [/\b(None|True|False)\b/, 1],
  [/\blambda\b.*:/, 1],
  [/\bprint\(/, 1],
  [/^\s*#(?!include|define|pragma)/, 0.5],
  [/^\s*\w+\s*=\s*[^=\s]/, 0.5],
];

/** A form of C, Java, JavaScript and the like, with the weight it takes away. */
const PENALTIES: [RegExp, number][] = [
  [/[{}]\s*$/, 2],
  [/^\s*}/, 2],
  [/;\s*$/, 2],
  [/=>/, 2],
  [/\b(function|const|let|var|public|private|static|void|namespace)\b/, 2],
  [/(===|!==|&&|\|\|)/, 2],
  [/^\s*\/\/|\/\*/, 1],
  [/^\s*#\s*(include|define|pragma)\b/, 3],
  [/\b(null|undefined|nil)\b/, 1],
];

/** Weight of a doubt: with no sign at all the score is 0, and it rises toward 1 with each one. */
const DOUBT = 2;

/**
 * How much the text looks like Python, from 0 to 1 (D5). It adds the weight of
 * each Python form it finds (`def`, `class`, `import`, `elif`, a `:` at the end
 * of a line, `self`) and takes away the weight of the forms of other languages
 * (braces, `;`, `=>`). Same text, same score.
 */
export function detectPython(source: string): number {
  let signs = 0;
  let penalties = 0;
  for (const line of source.split("\n")) {
    if (line.trim() === "") continue;
    for (const [pattern, weight] of SIGNS) {
      if (pattern.test(line)) signs += weight;
    }
    for (const [pattern, weight] of PENALTIES) {
      if (pattern.test(line)) penalties += weight;
    }
  }
  const net = Math.max(0, signs - penalties);
  return net / (signs + penalties + DOUBT);
}
