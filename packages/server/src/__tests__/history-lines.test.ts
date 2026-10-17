import { describe, expect, it } from "vitest";
import { lineCount } from "../history";

/** What the history counted before, with an array of lines. */
const bySplit = (text: string) =>
  text === "" ? 0 : text.split(/\r?\n/).length;

describe("lineCount", () => {
  it.each([
    "",
    "a",
    "a\n",
    "a\nb",
    "a\r\nb\r\n",
    "\n\n\n",
    "x = 1\r\ny = 2\nz = 3",
    "só um \r no meio\r\ne outra",
  ])("counts the lines of %j as a split does", (text) => {
    expect(lineCount(text)).toBe(bySplit(text));
  });
});
