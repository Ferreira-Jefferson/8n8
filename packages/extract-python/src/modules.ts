/** Dotted module name of a POSIX `.py` path; null for the root `__init__.py`. */
export function moduleNameOf(path: string): string | null {
  const parts = path.replace(/\.py$/, "").split("/");
  if (parts[parts.length - 1] === "__init__") parts.pop();
  return parts.length === 0 ? null : parts.join(".");
}

/** Dotted package that holds `path`; `""` for a file at the root. */
export function packageOf(path: string): string {
  return path.split("/").slice(0, -1).join(".");
}

/**
 * Base module of a relative import with `level` dots: the package of
 * `path`, up `level - 1` levels. Null when that goes above the root.
 */
export function relativeBase(path: string, level: number): string | null {
  const pkg = packageOf(path);
  const segments = pkg === "" ? [] : pkg.split(".");
  const up = level - 1;
  if (up >= segments.length) return null;
  return segments.slice(0, segments.length - up).join(".");
}
