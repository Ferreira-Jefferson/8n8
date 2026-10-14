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

/** Receivers that name a database connection, compared by whole segment. */
const DB_RECEIVERS = new Set(["db", "cursor", "conn", "connection", "session"]);

/**
 * Category of a call to a name the snippet neither defines nor imports
 * (VID-13): (a) a database receiver, (b) an e-mail name, (c) the table,
 * (d) EXTERNO.
 */
export function classifyUnknown(callee: string): ExternalCategory {
  const segments = callee.split(".");
  if (DB_RECEIVERS.has(segments[0] ?? "")) return "BANCO";
  const last = segments[segments.length - 1] ?? "";
  if (last.toLowerCase().includes("email")) return "EMAIL";
  return classify(callee);
}
