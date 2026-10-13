export const DEFAULT_MODEL = "~deepseek/deepseek-v4-flash-latest";

/** Model from CODE2N8N_MODEL, or the default when unset or empty (CORE-21). */
export function resolveModel(env: Record<string, string | undefined>): string {
  return env.CODE2N8N_MODEL || DEFAULT_MODEL;
}
