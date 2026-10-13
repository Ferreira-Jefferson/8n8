import type { ExternalCategory } from "@code2n8n/model";

/**
 * Tested in order. A plain name matches the first segment of the callee;
 * a name starting with "." matches the last segment (a method call).
 */
const TABLE: [ExternalCategory, string[]][] = [
  ["HTTP", ["requests", "httpx", "urllib", "aiohttp"]],
  ["BANCO", ["sqlite3", "psycopg", "sqlalchemy", ".execute", ".commit"]],
  ["ARQUIVO", ["open", "pathlib"]],
  ["EMAIL", ["smtplib"]],
];

/** `callee` is the full dotted name, with import aliases already replaced. */
export function classify(callee: string): ExternalCategory {
  const segments = callee.split(".");
  const first = segments[0];
  const last = `.${segments[segments.length - 1]}`;
  for (const [category, prefixes] of TABLE) {
    if (prefixes.some((p) => p === first || p === last)) return category;
  }
  return "EXTERNO";
}
