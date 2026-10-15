import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compares in constant time; hashing first makes tokens of any length comparable. */
export function sameToken(
  expected: string,
  received: string | undefined,
): boolean {
  if (received === undefined) return false;
  return timingSafeEqual(digest(expected), digest(received));
}
