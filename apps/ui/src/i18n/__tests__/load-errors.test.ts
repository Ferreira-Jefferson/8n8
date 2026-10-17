import { describe, expect, it } from "vitest";
import { en } from "../en";
import { ptBR } from "../pt-BR";

describe("the messages of a file that failed to load", () => {
  it.each(["flow.loadFailed", "flow.retry"] as const)(
    "%s exists in both languages",
    (key) => {
      expect(ptBR[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    },
  );
});
