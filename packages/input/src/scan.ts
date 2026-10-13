// Names are split so this file does not trip its own scan.
const NAMES = [
  ["write", "File"],
  ["append", "File"],
  ["mk", "dir"],
  ["r", "m"],
  ["re", "name"],
  ["un", "link"],
  ["copy", "File"],
  ["ch", "mod"],
  ["child", "_process"],
].map((parts) => parts.join(""));

const OPEN = ["op", "en"].join("");

/** Write-capable APIs that the input package must never use (PROJ-07). */
export function forbiddenUses(text: string): string[] {
  const found = NAMES.filter((n) =>
    new RegExp(String.raw`\b${n}\b`).test(text),
  );
  if (new RegExp(String.raw`\b${OPEN}\(`).test(text)) found.push(`${OPEN}(`);
  return found;
}
