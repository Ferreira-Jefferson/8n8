import { DEFAULT_LOCALE, type Locale } from "@8n8/model";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { en } from "./en";
import { type MessageKey, ptBR } from "./pt-BR";

export type { MessageKey };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {
  "pt-BR": ptBR,
  en,
};

/** The text of a key in a language; `{name}` marks a value that `vars` fills in. */
export function translate(
  locale: Locale,
  key: MessageKey,
  vars: Record<string, string | number> = {},
): string {
  return DICTIONARIES[locale][key].replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** The `t` function: a key and the values for its `{name}` marks. */
export type Translate = (
  key: MessageKey,
  vars?: Record<string, string | number>,
) => string;

/** Portuguese, for the pure helpers called without a language. */
export const defaultT: Translate = (key, vars) =>
  translate(DEFAULT_LOCALE, key, vars);

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** One or many: the `.one` or `.other` key of a count, with the count as `{n}`. */
export function plural(
  t: Translate,
  base:
    | "node"
    | "line"
    | "file"
    | "ignored"
    | "suggestion"
    | "link"
    | "edge.toCheck.alsoProven",
  n: number,
): string {
  return t(n === 1 ? `${base}.one` : `${base}.other`, { n });
}

/** The `t` of the current language; Portuguese when no provider wraps the tree. */
export function useT() {
  const locale = useContext(LocaleContext);
  return useMemo<Translate>(
    () => (key, vars) => translate(locale, key, vars),
    [locale],
  );
}
