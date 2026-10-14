import type { ExternalCategory } from "@code2n8n/model";

/**
 * Tested in order. A plain name matches the first segment of the callee or
 * the root of the module it was imported from; a name starting with "."
 * matches the last segment (a method call).
 */
const TABLE: [ExternalCategory, string[]][] = [
  [
    "HTTP",
    [
      "fetch",
      "axios",
      "got",
      "ky",
      "superagent",
      "undici",
      "node-fetch",
      "http",
      "https",
    ],
  ],
  [
    "BANCO",
    [
      "prisma",
      "@prisma/client",
      "knex",
      "pg",
      "mysql",
      "mysql2",
      "mongoose",
      "mongodb",
      "sqlite3",
      "better-sqlite3",
      "typeorm",
      ".query",
      ".execute",
    ],
  ],
  [
    "ARQUIVO",
    [
      "fs",
      "readFile",
      "readFileSync",
      "writeFile",
      "writeFileSync",
      "appendFile",
      "appendFileSync",
      "readdir",
      "readdirSync",
      "unlink",
      "unlinkSync",
      "mkdir",
      "mkdirSync",
      "createReadStream",
      "createWriteStream",
    ],
  ],
  ["EMAIL", ["nodemailer", "@sendgrid/mail", "resend"]],
];

/** `node:fs/promises` → `fs`; `@prisma/client/edge` → `@prisma/client`. */
export function moduleRoot(specifier: string): string {
  const bare = specifier.replace(/^node:/, "");
  const parts = bare.split("/");
  return bare.startsWith("@")
    ? parts.slice(0, 2).join("/")
    : (parts[0] ?? bare);
}

/**
 * `callee` is the full dotted name, with import aliases already replaced;
 * `module` is the specifier it was imported from, if any.
 */
export function classify(callee: string, module?: string): ExternalCategory {
  const segments = callee.split(".");
  const keys = [
    segments[0],
    `.${segments[segments.length - 1]}`,
    module === undefined ? undefined : moduleRoot(module),
  ];
  for (const [category, names] of TABLE) {
    if (names.some((n) => keys.includes(n))) return category;
  }
  return "EXTERNO";
}

/** Receivers that name a database connection, compared by whole segment. */
const DB_RECEIVERS = new Set([
  "db",
  "cursor",
  "conn",
  "connection",
  "session",
  "pool",
]);

/**
 * Category of a call to a name the snippet neither defines nor imports:
 * (a) a database receiver, (b) an e-mail name, (c) the table, (d) EXTERNO.
 */
export function classifyUnknown(callee: string): ExternalCategory {
  const segments = callee.split(".");
  if (DB_RECEIVERS.has(segments[0] ?? "")) return "BANCO";
  const last = (segments[segments.length - 1] ?? "").toLowerCase();
  if (last.includes("email") || last.includes("sendmail")) return "EMAIL";
  return classify(callee);
}
