import { cleanup, render, screen } from "@testing-library/react";
import { beforeAll } from "vitest";

// The first render and the first accessible-name query in a test file pay a
// one-off cold cost in jsdom (style and accessibility computation): seconds
// when every package runs its tests at once. Paying it here, once per file,
// keeps that cost out of whichever test happens to come first.
beforeAll(() => {
  render(
    <section aria-label="aquecimento">
      <h3>aquecimento</h3>
      <ul aria-label="itens">
        <li>item</li>
      </ul>
      <button type="button">aquecer</button>
    </section>,
  );
  screen.getByRole("region", { name: "aquecimento" });
  screen.getByRole("heading", { name: "aquecimento" });
  screen.getByRole("list", { name: "itens" });
  screen.getAllByRole("listitem");
  screen.getByRole("button", { name: "aquecer" });
  screen.getByText("item");
  cleanup();
});
