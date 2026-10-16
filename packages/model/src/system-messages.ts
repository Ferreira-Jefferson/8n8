import { DEFAULT_LOCALE, type Locale } from "./settings";

/** What the system says outside the screen: the terminal, the server and the LLM clients, one text per language of the system. */
const PT = {
  "error.noPrompt": "Não há prompt para a linguagem {language}.",
  "llm.invalidModel": "Modelo inválido para o Claude Code.",
  "llm.refused": "O Claude Code recusou o pedido: {subtype}.",
  "llm.unknownFormat": "O Claude Code respondeu um formato desconhecido.",
  "llm.tooLong": "O Claude Code respondeu demais.",
  "llm.notOpened": "O Claude Code não abriu.",
  "llm.timeout": "O Claude Code não respondeu em {seconds} s.",
  "llm.failed": "O Claude Code falhou (código {code}).",
  "llm.notFound": "O Claude Code não foi encontrado.",
  "llm.unknownProvider":
    'Provedor de LLM desconhecido: "{id}". Use um destes: {known}.',
  "cli.help": `Uso: 8n8 [pasta] [--no-open] [--no-app]

Abre o mapa da pasta (ou a tela inicial, sem pasta) numa janela própria do
Chrome ou do Edge, sem barra de endereço. Sem eles, abre no navegador padrão.

Opções:
  --no-open   sobe o servidor sem abrir o navegador
  --no-app    abre numa aba do navegador padrão, em vez da janela própria
  --help      mostra este texto

Variáveis de ambiente:
  APP8N8_PORT          porta do servidor (padrão 8148)
  APP8N8_CACHE_DIR     pasta do cache (padrão ~/.8n8/cache)
  APP8N8_HISTORY_DIR   pasta do historico.db (padrão ~/.8n8)
  APP8N8_CONFIG_DIR    pasta do config.json, gravado pela tela (padrão ~/.8n8)
  APP8N8_TOKEN         token de sessão fixo, com 32 caracteres ou mais (testes)

LLM (opcional; sem chave, o mapa funciona). Configure pela tela, em
Configurações. Uma variável definida ganha da tela:
  APP8N8_LLM_PROVIDER  claude-code (padrão, se o Claude Code está instalado), openrouter
                       (padrão sem ele), openai, anthropic ou openai-compatible
  APP8N8_CLAUDE_PATH   o executável do Claude Code; a tela também escolhe
  OPENROUTER_API_KEY, OPENROUTER_BASE_URL
  OPENAI_API_KEY, ANTHROPIC_API_KEY
  APP8N8_LLM_API_KEY, APP8N8_LLM_BASE_URL   openai-compatible (a URL só vem daqui)
  APP8N8_MODEL, APP8N8_REVIEW_MODEL
  APP8N8_AUTO_SUMMARY, APP8N8_AUTO_SUGGESTIONS   1 gera sem clique, 0 só com clique`,
  "cli.seeHelp": "Veja 8n8 --help.",
  "cli.folderNotFound": "Pasta não encontrada: {path}",
  "cli.tokenShort": "APP8N8_TOKEN precisa de 32 caracteres ou mais.",
  "cli.portInUse":
    "A porta {port} já está em uso. Feche o outro processo e tente de novo.",
  "cli.serverError": "Erro ao subir o servidor: {message}",
  "cli.running": "8n8 em {url}",
} as const;

export type SystemKey = keyof typeof PT;

const EN: Record<SystemKey, string> = {
  "error.noPrompt": "There is no prompt for the language {language}.",
  "llm.invalidModel": "Invalid model for Claude Code.",
  "llm.refused": "Claude Code refused the request: {subtype}.",
  "llm.unknownFormat": "Claude Code answered in an unknown format.",
  "llm.tooLong": "Claude Code answered with too much text.",
  "llm.notOpened": "Claude Code did not start.",
  "llm.timeout": "Claude Code did not answer in {seconds} s.",
  "llm.failed": "Claude Code failed (code {code}).",
  "llm.notFound": "Claude Code was not found.",
  "llm.unknownProvider":
    'Unknown LLM provider: "{id}". Use one of these: {known}.',
  "cli.help": `Usage: 8n8 [folder] [--no-open] [--no-app]

Opens the map of the folder (or the start screen, with no folder) in its own
Chrome or Edge window, with no address bar. Without them, it opens in the
default browser.

Options:
  --no-open   starts the server without opening the browser
  --no-app    opens in a tab of the default browser, not in its own window
  --help      shows this text

Environment variables:
  APP8N8_PORT          server port (default 8148)
  APP8N8_CACHE_DIR     cache folder (default ~/.8n8/cache)
  APP8N8_HISTORY_DIR   folder of historico.db (default ~/.8n8)
  APP8N8_CONFIG_DIR    folder of config.json, written by the screen (default ~/.8n8)
  APP8N8_TOKEN         fixed session token, with 32 characters or more (tests)

LLM (optional; with no key, the map works). Set it up on the screen, in
Settings. A variable that is set wins over the screen:
  APP8N8_LLM_PROVIDER  claude-code (default, if Claude Code is installed), openrouter
                       (default without it), openai, anthropic or openai-compatible
  APP8N8_CLAUDE_PATH   the Claude Code executable; the screen can also pick it
  OPENROUTER_API_KEY, OPENROUTER_BASE_URL
  OPENAI_API_KEY, ANTHROPIC_API_KEY
  APP8N8_LLM_API_KEY, APP8N8_LLM_BASE_URL   openai-compatible (the URL only comes from here)
  APP8N8_MODEL, APP8N8_REVIEW_MODEL
  APP8N8_AUTO_SUMMARY, APP8N8_AUTO_SUGGESTIONS   1 generates with no click, 0 only on click`,
  "cli.seeHelp": "See 8n8 --help.",
  "cli.folderNotFound": "Folder not found: {path}",
  "cli.tokenShort": "APP8N8_TOKEN needs 32 characters or more.",
  "cli.portInUse":
    "Port {port} is already in use. Close the other process and try again.",
  "cli.serverError": "Could not start the server: {message}",
  "cli.running": "8n8 at {url}",
};

const MESSAGES: Record<Locale, Record<SystemKey, string>> = {
  "pt-BR": PT,
  en: EN,
};

/** The text of a key in a language; `{name}` marks a value that `vars` fills in. */
export function translateSystem(
  locale: Locale,
  key: SystemKey,
  vars: Record<string, string | number> = {},
): string {
  return MESSAGES[locale][key].replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * An error the person may read: it keeps its key, so the layer that knows the
 * language says it in that language. Its own `message` is Portuguese, the default.
 */
export class LocalizedError extends Error {
  constructor(
    readonly key: SystemKey,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(translateSystem(DEFAULT_LOCALE, key, vars));
  }
}

/** The message of any thrown value, in the language of the system when the error carries a key. */
export function messageOf(err: unknown, locale: Locale): string {
  if (err instanceof LocalizedError) {
    return translateSystem(locale, err.key, err.vars);
  }
  return err instanceof Error ? err.message : String(err);
}
