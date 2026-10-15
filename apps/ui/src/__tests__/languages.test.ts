import type { LanguageInfo } from "@8n8/model";
import { describe, expect, it } from "vitest";
import {
  listExtensions,
  noFilesText,
  readsText,
  snippetFileName,
} from "../languages";

const py: LanguageInfo = { id: "python", label: "Python", extensions: [".py"] };
const ts: LanguageInfo = {
  id: "typescript",
  label: "TypeScript",
  extensions: [".ts", ".tsx"],
};
const certain = (id: string) => ({ id, label: id, uncertain: false });

describe("listExtensions", () => {
  it("gives an empty text for no item", () => {
    expect(listExtensions([])).toBe("");
  });
  it("gives the item alone", () => {
    expect(listExtensions([".py"])).toBe(".py");
  });
  it("puts the word between two items", () => {
    expect(listExtensions([".py", ".ts"])).toBe(".py e .ts");
    expect(listExtensions([".py", ".ts"], "ou")).toBe(".py ou .ts");
  });
  it("uses commas and the word before the last of three", () => {
    expect(listExtensions([".py", ".ts", ".js"])).toBe(".py, .ts e .js");
    expect(listExtensions([".py", ".ts", ".js"], "ou")).toBe(".py, .ts ou .js");
  });
});

describe("readsText and noFilesText", () => {
  it("use generic words, with no language, for an empty list", () => {
    expect(readsText([])).toBe(
      "O 8n8 lê os arquivos de código da pasta e das subpastas.",
    );
    expect(noFilesText([])).toBe(
      "Nenhum arquivo de código encontrado na pasta.",
    );
  });
  it("name the extensions of every plugin, in the list's order", () => {
    expect(readsText([py, ts])).toBe(
      "O 8n8 lê os arquivos .py, .ts e .tsx da pasta e das subpastas.",
    );
    expect(noFilesText([py])).toBe("Nenhum arquivo .py encontrado na pasta.");
    expect(noFilesText([py, ts])).toBe(
      "Nenhum arquivo .py, .ts ou .tsx encontrado na pasta.",
    );
  });
});

describe("snippetFileName", () => {
  it("takes the first extension of the detected language", () => {
    expect(snippetFileName(certain("python"), [py, ts])).toBe("trecho.py");
    expect(snippetFileName(certain("typescript"), [py, ts])).toBe("trecho.ts");
  });
  it("is 'trecho' with no language, an unknown one or no list", () => {
    expect(snippetFileName(undefined, [py, ts])).toBe("trecho");
    expect(snippetFileName(certain("go"), [py, ts])).toBe("trecho");
    expect(snippetFileName(certain("python"), [])).toBe("trecho");
  });
});
