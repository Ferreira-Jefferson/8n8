import { type ClaimId, DEFAULT_LOCALE, type Locale } from "@8n8/model";
import { wordsOf } from "./messages";
import type { DraftClaim } from "./sentences";

/** Units checked by layer one (spec, "Unidades checadas na camada 1"). Changing it changes the reviewer version. */
export const UNITS = [
  "kg",
  "g",
  "mg",
  "t",
  "km",
  "m",
  "cm",
  "mm",
  "l",
  "ml",
  "R$",
  "US$",
  "€",
  "%",
  "ms",
  "s",
  "seg",
  "segundos",
  "min",
  "minutos",
  "h",
  "horas",
  "dias",
  "KB",
  "MB",
  "GB",
] as const;

/** What English adds to `UNITS`; Portuguese keeps its list as it was, so its reviewer version and caches stay. */
export const UNITS_EN = [
  "sec",
  "secs",
  "second",
  "seconds",
  "minute",
  "minutes",
  "hr",
  "hrs",
  "hour",
  "hours",
  "day",
  "days",
] as const;

/** The units layer one checks in a language of the system. */
export function unitsOf(locale: Locale): readonly string[] {
  return locale === "en" ? [...UNITS, ...UNITS_EN] : UNITS;
}

/** `code` is the normalized node code; `neighbours` are the names it calls and is called by. */
export interface CheckContext {
  code: string;
  neighbours: string[];
  /** The language of the problems it reports; Portuguese when absent. */
  locale?: Locale;
}

export interface Problem {
  id: ClaimId;
  text: string;
  problem: string;
}

const WORD = "[\\p{L}\\p{N}_]";
const BACKTICKED = /`[^`]*`/g;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every number outside backticks must be a numeric token of the code (`,` ↔ `.`) or sit inside a neighbour name (FID-02). */
export function checkNumbers(text: string, ctx: CheckContext): string | null {
  let rest = text.replace(BACKTICKED, " ");
  for (const name of [...ctx.neighbours].sort((a, b) => b.length - a.length)) {
    if (name !== "") rest = rest.split(name).join(" ");
  }
  for (const [n] of rest.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const variants = [n.replace(",", "."), n.replace(".", ",")];
    const inCode = variants.some((v) =>
      new RegExp(`(?<![\\w.])${escapeRegex(v)}(?!\\w)`).test(ctx.code),
    );
    if (!inCode) {
      return wordsOf(ctx.locale ?? DEFAULT_LOCALE).numberAbsent(n);
    }
  }
  return null;
}

/** Lower-case code tokens, split on `_`, on any non-alphanumeric char and between digits and letters. */
function codeTokens(code: string): Set<string> {
  return new Set(
    code
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u)
      .filter((t) => t !== ""),
  );
}

/** A unit of the list in the text must appear in the code, comments and strings included (FID-03). */
export function checkUnits(text: string, ctx: CheckContext): string | null {
  const tokens = codeTokens(ctx.code);
  const lowerCode = ctx.code.toLowerCase();
  for (const unit of unitsOf(ctx.locale ?? DEFAULT_LOCALE)) {
    const isSymbol = /[^\p{L}]/u.test(unit);
    const pattern = isSymbol
      ? new RegExp(escapeRegex(unit), "iu")
      : unit.length === 1
        ? new RegExp(`\\d\\s?${unit}(?!${WORD})`, "iu")
        : new RegExp(`(?<![\\p{L}_])${unit}(?!${WORD})`, "iu");
    if (!pattern.test(text)) continue;
    const present = isSymbol
      ? lowerCode.includes(unit.toLowerCase())
      : tokens.has(unit.toLowerCase());
    if (!present) {
      return wordsOf(ctx.locale ?? DEFAULT_LOCALE).unitAbsent(unit);
    }
  }
  return null;
}

/** Each backticked span, without a trailing `(...)`, must be in the code at identifier boundaries or be a neighbour name (FID-04). */
export function checkIdentifiers(
  text: string,
  ctx: CheckContext,
): string | null {
  for (const [span] of text.matchAll(BACKTICKED)) {
    const name = span
      .slice(1, -1)
      .replace(/\(.*\)$/s, "")
      .trim();
    if (name === "" || ctx.neighbours.includes(name)) continue;
    const bounded = new RegExp(
      `(?<!${WORD})${escapeRegex(name)}(?!${WORD})`,
      "u",
    );
    if (!bounded.test(ctx.code)) {
      return wordsOf(ctx.locale ?? DEFAULT_LOCALE).identifierAbsent(name);
    }
  }
  return null;
}

const RULES = [checkNumbers, checkUnits, checkIdentifiers];

/** Runs the three rules on each claim; one problem per failed claim (C2). */
export function layerOne(claims: DraftClaim[], ctx: CheckContext): Problem[] {
  const problems: Problem[] = [];
  for (const claim of claims) {
    const found = RULES.map((rule) => rule(claim.text, ctx)).filter(
      (p): p is string => p !== null,
    );
    if (found.length > 0) {
      problems.push({
        id: claim.id,
        text: claim.text,
        problem: found.join("; "),
      });
    }
  }
  return problems;
}
