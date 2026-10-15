import { describe, expect, it, vi } from "vitest";
import { folderToOpen } from "../folder";

describe("folderToOpen (VSC-01, VSC-02)", () => {
  it("opens the Explorer's folder first, without asking", async () => {
    const ask = vi.fn();
    expect(await folderToOpen("C:/x", ["C:/ws"], ask)).toBe("C:/x");
    expect(ask).not.toHaveBeenCalled();
  });

  it("opens the first workspace folder from the palette, without asking", async () => {
    const ask = vi.fn();
    expect(await folderToOpen(undefined, ["C:/ws", "C:/b"], ask)).toBe("C:/ws");
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks for a folder when no workspace is open", async () => {
    expect(await folderToOpen(undefined, [], async () => "C:/escolhida")).toBe(
      "C:/escolhida",
    );
  });

  it("opens nothing when the user cancels the pick", async () => {
    expect(await folderToOpen(undefined, [], async () => undefined)).toBeNull();
  });
});
