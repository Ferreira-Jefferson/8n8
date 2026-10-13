/** Evidence lines as compact ranges: [5,6,7,9] → "L5–7, L9" (FID-12). */
export function formatLines(lines: number[]): string {
  const sorted = [...lines].sort((a, b) => a - b);
  const groups: [number, number][] = [];
  for (const line of sorted) {
    const last = groups.at(-1);
    if (last && line <= last[1] + 1) last[1] = Math.max(last[1], line);
    else groups.push([line, line]);
  }
  return groups.map(([a, b]) => (a === b ? `L${a}` : `L${a}–${b}`)).join(", ");
}
