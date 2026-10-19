import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary";

afterEach(cleanup);

function Level({ broken }: { broken: boolean }) {
  if (broken) throw new RangeError("Maximum call stack size exceeded");
  return <p>nível</p>;
}

describe("ErrorBoundary (G13)", () => {
  it("shows the fallback instead of a blank screen, and tries again on a new resetKey", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const fallback = <p role="alert">Não deu para desenhar este nível.</p>;
    const { rerender } = render(
      <ErrorBoundary resetKey="a" fallback={fallback}>
        <Level broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Não deu para desenhar este nível.",
    );
    // The same level stays on the fallback.
    rerender(
      <ErrorBoundary resetKey="a" fallback={fallback}>
        <Level broken={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByText("nível")).toBeNull();
    // Another level draws again.
    rerender(
      <ErrorBoundary resetKey="b" fallback={fallback}>
        <Level broken={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("nível")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    quiet.mockRestore();
  });
});
