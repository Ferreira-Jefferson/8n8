/** `occurrence` is 1-based, in code order; the first one has no suffix. */
export function topLevelId(
  kind: "function" | "class",
  name: string,
  occurrence: number,
): string {
  const prefix = kind === "function" ? "fn" : "cls";
  const suffix = occurrence > 1 ? `#${occurrence}` : "";
  return `${prefix}:${name}${suffix}`;
}

export function childId(parentId: string, segment: string): string {
  return `${parentId}/${segment}`;
}
