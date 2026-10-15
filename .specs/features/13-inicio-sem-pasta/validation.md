# Início sem pasta Validation

**Date**: 2026-10-15 (round 2)
**Spec**: `.specs/features/13-inicio-sem-pasta/spec.md`
**Diff range**: `3680b15..6a6ec43` (`14bead6` spec, `2c2154d` fix, `6a6ec43` tests for the round 1 gap and the VSC-01 note)
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 13-inicio-sem-pasta - PASS

Every AC (HOME-01..04) has a test that asserts the outcome the spec defines. Every mutant that maps to an AC is killed, except W6, which has no visible effect.

- **Round 1** (`2c2154d`): FAIL. 11 mutants, 9 killed, 2 survived. V3 (HOME-02) was a real gap: the Explorer command could open the workspace root in place of the folder the user clicked, and no test noticed. W6 has no visible effect.
- **Round 2** (`6a6ec43`, test and spec only): V3 is killed. V1, V2 and the web sample W1, W2, W4 and W8 are still killed.

No product defect was found in either round.

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| HOME-01 | The palette opens the "8n8" panel on the start screen and maps no folder, with or without a workspace folder | Code: `apps/editors/vscode/src/extension.ts:130` `show(uri?.fsPath ?? null)`; the palette passes no `uri`. Integration `apps/editors/vscode/src/__tests__/integration/suite.ts:60-75` (round 2 lines), VS Code opened **with** a workspace folder: the page loads, reads `/api/history`, makes no `/api/project` call, and `pageFolder(api.lastHtml())` is `null`. `apps/editors/vscode/src/__tests__/webview-html.test.ts:69` `folder: null` → no folder meta | ✅ PASS (the "without a workspace folder" case is not run. The code never reads the workspace, so this case follows from the code) |
| HOME-02 | The Explorer command opens the map of **that** folder, as before | `suite.ts:77-79` Explorer on the workspace root → `expectFolder(api.lastHtml(), workspace)`: the page's `8n8-folder` meta equals the folder, without regard to case, then `/api/project` 200; `suite.ts:189-192` Explorer on `frete` → `expectFolder(api.lastHtml(), frete)`, a new page, a new `/api/project` 200, one panel. `expectFolder` is defined at `suite.ts:20-25` | ✅ PASS (round 1: PARTIAL, V3 survived; closed by `6a6ec43`) |
| HOME-03 | A folder map shows "Início", not "Novo código". The click goes back to the start screen with the folder path in the field, from any level | `apps/ui/src/__tests__/App.test.tsx:700-711` no "Novo código", "Início" → no canvas, field = `lojaRoot`; `:713-727` from depth 2 "Início" → no canvas, "Mapear pasta" visible, the new map at depth 0; `:467` folder map → "Início" → paste a snippet. E2E `e2e/pasta-local.e2e.ts:257-272` two levels deep: "Novo código" count 0, "Início" → 0 nodes, field = LOJA, "Mapear pasta" → 5 nodes with `dir:pedidos`; `e2e/historico.e2e.ts:296` | ✅ PASS |
| HOME-04 | A snippet map keeps "Novo código", which goes back to the text | `App.test.tsx:688-698` no "Início" on a snippet map, "Novo código" → editor with the same text; `e2e/historico.e2e.ts:108` a snippet map's "Novo código" | ✅ PASS |

Code: `apps/ui/src/App.tsx:509` label `mapped.kind === "project" ? "Início" : "Novo código"`; `:319-323` `newCode` clears the map and goes `home` for a folder and `editor` for a snippet. README `README.md:129` describes the new palette behaviour and "Início".

---

## Discrimination Sensor

Run in an isolated worktree (`git worktree add --detach C:/w13 2c2154d`, `pnpm install --offline --frozen-lockfile`). Web mutants ran `apps/ui/src/__tests__/App.test.tsx`. VS Code mutants ran `pnpm --filter 8n8-vscode test:integration` with `APP8N8_VSCODE_PATH` set to the downloaded VS Code 1.142.0. E2E mutants rebuilt the CLI and ran the named tests. Each mutant was reverted after its run.

| # | Mutant (file) | AC | Tests run | Result |
| - | ------------- | -- | --------- | ------ |
| V1 | palette opens the first workspace folder again (`extension.ts:130`) | 01 | integration | Killed ("A paleta mandou uma pasta para a página.") |
| V2 | Explorer ignores its `uri`, always `show(null)` | 02 | integration | Killed (no `/api/project` 200 for the folder map) |
| V3 | Explorer opens the workspace root, not its `uri` | 02 | integration | **Survived** (killed in round 2) |
| W1 | label always "Início" (`App.tsx:509`) | 04 | web App; e2e `historico` snippet test | Killed (3 unit tests incl. HOME-04; e2e `historico.e2e.ts:108`) |
| W2 | label always "Novo código" | 03 | web App; e2e HOME-03 + launcher test | Killed (unit 3; e2e 2) |
| W3 | labels swapped | 03/04 | web App | Killed (6) |
| W4 | "Início" goes to the editor, not home (`App.tsx:322`) | 03 | web App; e2e HOME-03 | Killed (unit 3; e2e 1) |
| W5 | snippet "Novo código" goes home | 04 | web App | Killed (3) |
| W6 | `newCode` skips `clearMap()` | 03 | web App | Survived (equivalent, see note) |
| W7 | `clearMap` keeps the nav depth (no `reset`) | 03 | web App | Killed (3, incl. `:713` depth 0) |
| W8 | "Início" clears the folder field | 03 | web App; e2e HOME-03 | Killed (unit 1; e2e 1) |

W1 passes the e2e HOME-03 test and the launcher test, because neither has a snippet map. The `historico` snippet test and the unit HOME-04 test kill it.

W6 is equivalent for the spec. Every new map goes through `show()`, which calls `clearMap()` first (`App.tsx:262-266`). The home screen does not render the map. So the user sees the same screens with or without the extra `clearMap()`. The only difference is stale state held in memory. HOME-03 does not ask for that state to be cleared.

### Round 2 (`6a6ec43`)

The worktree was `C:/w13b` at `6a6ec43`, set up with `pnpm install --offline --frozen-lockfile`. The integration baseline passed (exit 0) before mutating.

| # | Mutant | AC | Tests run | Result |
| - | ------ | -- | --------- | ------ |
| V3 | Explorer opens the workspace root, not its `uri` | 02 | integration | Killed ("A página recebeu a pasta …\loja, e não …\loja\frete.") |
| V1 | palette opens the first workspace folder | 01 | integration | Killed ("A paleta mapeou uma pasta sem a pessoa pedir.") |
| V2 | Explorer ignores its `uri` | 02 | integration | Killed ("A página recebeu a pasta null, e não …\loja.") |
| W1, W2, W4, W8 | round 1 kills, rerun as a regression sample | 04, 03, 03, 03 | web App | All killed |

`6a6ec43` changes no product code (only `suite.ts` and the feature 10 spec), so the round 1 web and e2e kills still hold.

Main repo, round 1: no file was written there except this file. `git status` changed during the run only in `apps/ui/src/panel/DetailPanel.tsx` and its test, which the other sessions edit. The worktree is unregistered (`git worktree list` shows only master). `git worktree remove --force` could not delete every file, so the folder `C:/w13` is still on disk and needs a manual delete.

---

## Gaps (ranked)

Round 2 closed gaps 1 and 3. `suite.ts` now checks the folder that the page receives, and `.specs/features/10-extensao-vscode/spec.md:51` VSC-01 now says the palette opens the start screen and points to HOME-01. Gap 2 stays open as a noted low risk. The list below is the round 1 record.

1. **V3, HOME-02: no test checks which folder the Explorer opens.** In `apps/editors/vscode/src/__tests__/integration/suite.ts`, after the Explorer command on `frete` (`:170-174`), assert that `api.lastHtml()` holds the `8n8-folder` meta and that its content ends in `frete`. The VSC-01 check at `:52` already reads `lastHtml()`, so this check follows the same pattern. Another option is to check the `/api/project` request body, if the bridge log records it.
2. **HOME-01 without a workspace folder is not run.** The integration test opens VS Code with a folder. Today the code cannot depend on the workspace (`extension.ts:130`), so the risk is low. A unit test of `open` would need the `vscode` module, so this is a note, not a request.
3. **Spec drift: feature 10 VSC-01 still describes the old behaviour.** `.specs/features/10-extensao-vscode/spec.md:51` says the palette maps the first workspace folder and opens a dialog with no folder. Feature 13 says it "Muda o VSC-01". Update VSC-01, or add a note there that HOME-01 replaces it.

## Gates

All gates ran on `2c2154d` in `C:/w13`:

- web unit: 30 files, 482/482 passed (`App.test.tsx` 59/59).
- vscode unit: 7 files, 50/50 passed.
- `pnpm typecheck`: exit 0.
- VS Code integration (`test:integration`, VS Code 1.142.0): exit 0, "teste de integração no VS Code passou".
- e2e `e2e/pasta-local.e2e.ts` + `e2e/historico.e2e.ts`: 25/25 passed.
- Round 2 (`6a6ec43`, in `C:/w13b`): VS Code integration exit 0, vscode unit 50/50, `pnpm typecheck` exit 0, web `App.test.tsx` 59/59 (the baseline of the mutant sample).
- The full e2e suite was not run by the Verifier.

Worktrees: neither is registered any more (`git worktree list` shows only master). `git worktree remove --force` could not delete every file, so the folders `C:/w13` and `C:/w13b` are still on disk and need a manual delete. Round 2 wrote only this file and the traceability row in `spec.md` in the main repo.
