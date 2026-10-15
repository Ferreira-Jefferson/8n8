import { describe, expect, it, vi } from "vitest";

// The vscode module only exists inside the editor: a stand-in with what activate() touches.
vi.mock("vscode", () => ({
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ViewColumn: { Beside: -2 },
  Uri: {
    joinPath: (base: { path: string }, ...parts: string[]) => ({
      path: [base.path, ...parts].join("/"),
    }),
  },
  commands: { registerCommand: () => ({ dispose: () => {} }) },
  window: {},
  workspace: { workspaceFolders: [] },
}));

const { activate } = await import("../extension");

function context(extensionMode: number) {
  return {
    extensionMode,
    extensionPath: "C:/ext",
    extensionUri: { path: "/ext" },
    globalStorageUri: { fsPath: "C:/storage/8n8" },
    subscriptions: [] as unknown[],
    secrets: {},
    globalState: {},
  } as unknown as Parameters<typeof activate>[0];
}

describe("activate exposes the test API only to its own tests (VSC-11)", () => {
  it.each([
    ["Production", 1],
    ["Development", 2],
  ])(
    "returns nothing in %s mode: no other extension reaches the core",
    (_, mode) => {
      expect(activate(context(mode))).toBeUndefined();
    },
  );

  it("returns the test API in Test mode", () => {
    const api = activate(context(3));
    expect(api).toBeDefined();
    expect(api?.dataDir()).toBe("C:/storage/8n8");
  });

  it("registers both commands in every mode", () => {
    const ctx = context(1);
    activate(ctx);
    expect(ctx.subscriptions).toHaveLength(2);
  });
});
