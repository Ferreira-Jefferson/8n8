export const DEFAULT_MODEL = "~deepseek/deepseek-v4-flash-latest";

/** Model from CODE2N8N_MODEL, or the default when unset or empty (CORE-21). */
export function resolveModel(env: Record<string, string | undefined>): string {
  return env.CODE2N8N_MODEL || DEFAULT_MODEL;
}

/** Reviewer model from CODE2N8N_REVIEW_MODEL, or the summary model when unset or empty (FID-15). */
export function resolveReviewModel(
  env: Record<string, string | undefined>,
): string {
  return env.CODE2N8N_REVIEW_MODEL || resolveModel(env);
}
