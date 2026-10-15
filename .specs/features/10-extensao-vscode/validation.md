# Extensão VS Code Validation

**Date**: 2026-10-15 (round 3 of 3)
**Spec**: `.specs/features/10-extensao-vscode/spec.md`
**Diff range**: `e3455a9..0c19948` (round 1 `..917f666`; round 2 fixes `e029769`, `5dfc783`; round 3 fix `0c19948`)
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 10-extensao-vscode - PASS

All 15 ACs trace to a test that asserts the outcome the spec defines. All gates are green. The sensor killed every mutant that maps to an AC: 28 of 28 non-equivalent in round 1 after the fixes, 10 of 10 in round 2 after the fixes, and 4 of 4 in round 3. Two mutants of the `.vscode-test` exclusion anchoring survive (S4, S5). No AC covers that anchoring, so they are an advisory and do not block (see below).

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T8 | ✅ Done | Plus verifier fix commits `e029769`, `5dfc783`, `0c19948` |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| VSC-01 | The palette opens the "8n8" panel on the first workspace folder. With no folder, a dialog. Cancel opens nothing | `apps/editors/vscode/src/__tests__/integration/suite.ts:42` `executeCommand("8n8.abrirMapa")`, `:54` `POST /api/project` 200; `apps/editors/vscode/src/__tests__/folder.test.ts:11` `toBe("C:/ws")`, `:23` `toBeNull()` | ✅ PASS |
| VSC-02 | The Explorer command maps that folder | `suite.ts` `/api/project` 200 after `8n8.abrirMapaDaPasta(frete)`; `apps/editors/vscode/src/__tests__/manifest.test.ts:39` menu `explorerResourceIsFolder` | ✅ PASS |
| VSC-03 | The panel is reused, brought to the front, and opens the new folder | `suite.ts` `mapTabs() !== 1` throws (I1 killed) | ✅ PASS |
| VSC-04 | Through the bridge: project 200, settings 200, summary `cachedOnly` 200 `not-cached`, history 200 with the map | `suite.ts:54`, `:62`, `:115` `status !== "not-cached"`, `:132` `items.length === 0` | ✅ PASS |
| VSC-05 | Cache and history in the extension's global storage; key only in SecretStorage; the rest in globalState | `apps/editors/vscode/src/__tests__/store.test.ts:39`, `:52`; `apps/editors/vscode/src/__tests__/panel.test.ts:19` `dataPaths`; `apps/editors/vscode/src/__tests__/activate.test.ts:45` `dataDir()).toBe("C:/storage/8n8")` (= `globalStorageUri.fsPath`); `suite.ts` `dataDir()` must equal `<APP8N8_TEST_USER_DATA>/User/globalStorage/ferreira-jefferson.8n8-vscode` | ✅ PASS (R6/S2/S3 killed) |
| VSC-06 | The host env reaches the core | `run.ts` `APP8N8_AUTO_SUMMARY: "1"`; `suite.ts:98` throws unless `autoSummary === true` and `env.autoSummary === "APP8N8_AUTO_SUMMARY"` | ✅ PASS (I5/R4 killed) |
| VSC-07 | `.vsix` with bundle, grammars, screen, PTS; no deps, no install scripts | `manifest.test.ts:20`; `build.test.ts:30,38,47`; `package` run in round 2 → 44 files, 1.26 MB (no extension source change since) | ✅ PASS |
| VSC-08 | Real VS Code: panel, page under CSP, `ready`, `POST /api/project` 200 | `suite.ts:42-56` (I4 killed) | ✅ PASS |
| VSC-09 | No port imports in `apps/editors/vscode`; `pnpm check` fails otherwise | `apps/cli/src/__tests__/guards.test.ts:203`, `:225` (M24-M27 killed) | ✅ PASS |
| VSC-10 | Only `{id,method,path,body?}`, 4 methods, safe `/api/` path, body ≤ 1 048 576 bytes only on POST/PUT, else 400 without the core; a core failure gives 500 | `apps/editors/vscode/src/__tests__/bridge.test.ts:99-125` 19 cases `status 400` + `seen toEqual([])`; `:136` 1 048 576 bytes → 200; `:146` → `status: 500` | ✅ PASS (R7, R8, R10 killed) |
| VSC-11 | The bridge adds Host and token; no token in the webview or its HTML; the core refuses without it; the test API only in `ExtensionMode.Test` | `bridge.test.ts:49-50`, `:94` 401; `apps/web/src/__tests__/vscode-host.test.ts:85`; `suite.ts:77` no 64-hex string in `lastHtml()`; `activate.test.ts:38` Production and Development `toBeUndefined()`, `:44` Test `toBeDefined()` | ✅ PASS (I3/R3, R5/S1, S1b killed) |
| VSC-12 | Exact CSP; `localResourceRoots` only the packaged screen | `apps/editors/vscode/src/__tests__/webview-html.test.ts:31` exact policy; `panel.test.ts:6`; `suite.ts:74` exactly `[<ext>/dist/web]` | ✅ PASS (I2/R1/R2 killed) |
| VSC-13 | A `vscode` import outside `apps/editors/vscode` fails `pnpm check`, proven by the guards test | `guards.test.ts:221` | ✅ PASS |
| VSC-14 | CODEOWNERS on the bridge and the webview HTML | `.github/CODEOWNERS:16-17` | ✅ PASS (doc check) |
| VSC-15 | Editor guide and README `.vsix` install section | `docs/adicionar-editor.md:9-41`; `README.md:105-119` | ✅ PASS (doc check) |

**Status**: ✅ All ACs covered.

---

## Discrimination Sensor

Each round ran in an isolated worktree under the scratchpad, with its own `pnpm install --offline`. Integration mutants ran with VS Code 1.142.0 from the main tree's gitignored `apps/editors/vscode/.vscode-test/`, used only as an executable. The installed VS Code is mid-update and refuses to start.

### Round 3 (`0c19948`)

| Mutant | File | Description | Result |
| ------ | ---- | ----------- | ------ |
| S1 | `apps/editors/vscode/src/extension.ts:152` | test API returned in every mode | ✅ Killed (unit) |
| S1b | `extension.ts:152` | test API returned in Development too | ✅ Killed (unit) |
| S2 | `extension.ts:43` | data folder = `<extension>/data` | ✅ Killed (unit) |
| S3 | `extension.ts:43` | same, against the integration suite | ✅ Killed ("Pasta de dados fora do globalStorage") |
| S4 | `.dependency-cruiser.cjs:203` | exclusion widened from `^apps/editors/vscode/\.vscode-test/` to any `/.vscode-test/` | ⚠️ Survived (advisory, no AC) |
| S5 | `apps/cli/src/__tests__/guards.test.ts:244` | scan skip widened to any folder named `.vscode-test` | ⚠️ Survived (advisory, no AC) |

### Earlier rounds

- **Round 1** (`917f666`): 28 killed, 1 equivalent (M05). I2, I3, I5 and M12 survived and were fixed.
- **Round 2** (`5dfc783`): R1-R4, R6b, R7, R8 and R10 killed. R5 and R6 survived; they are fixed and killed here as S1 and S2/S3.

**Sensor depth**: P0 (security): 49 mutants over three rounds.
**Result**: PASS. Every AC-backed mutant is killed. S4 and S5 are an advisory.
**Isolation**: worktree removed after each round; real-tree `git status --porcelain` identical to its baseline each time.

### Advisory (non-blocking): S4, S5

Round 3 anchored both exclusions to `apps/editors/vscode/.vscode-test`, as round 2 recommended. No test fails if the anchoring is widened again. The folder is gitignored, so the exposure is small. To pin it, add to `guards.test.ts` a rule-breaking probe in some other `.vscode-test` folder, e.g. `packages/server/.vscode-test/probe.ts` importing `vscode`, and expect `pnpm check` to report it.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ |
| No scope creep | ✅ |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ |
| Per-layer Coverage Expectation | ✅ |
| Every test maps to a spec requirement | ✅ |
| Documented guidelines followed: `CLAUDE.md`, `CONTRIBUTING.md` | ✅ |

---

## Failure Paths

- [x] VSC-10: invalid message → `400 {"error":"invalid message"}`, core untouched (`bridge.test.ts:120-124`).
- [x] VSC-10: GET/DELETE with a body → 400 (`bridge.test.ts:115-116`).
- [x] VSC-10: core throws → 500, token not in the body (`bridge.test.ts:146`).
- [x] VSC-11: wrong token → 401 (`bridge.test.ts:94`).
- [x] VSC-11: Production/Development → no exports (`activate.test.ts:38`).

---

## Gate Check

- `pnpm typecheck`: ✅ exit 0
- `pnpm check`: ✅ exit 0 (dependency-cruiser checked 332 modules: no violations, with `apps/editors/vscode/.vscode-test` present)
- `pnpm test`: ✅ exit 0. 1898 passed, 3 skipped (outside the diff). `apps/editors/vscode` 54.
- `pnpm --filter 8n8-vscode test:integration` (real tree, VS Code 1.142.0 from `.vscode-test`): ✅ "teste de integração no VS Code passou"
- `pnpm --filter 8n8-vscode package`: ✅ in round 2 (44 files). Round 3 changes only tests and config.
- `pnpm e2e`: ✅ 142/142 in round 1. Rounds 2-3 do not touch `apps/web` or the CLI runtime.

---

## Requirement Traceability Update

| Requirement | Previous | New |
| ----------- | -------- | --- |
| VSC-01..15 | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready (PASS)

**Spec-anchored check**: 15/15 ACs matched the spec outcome.
**Sensor**: every AC-backed mutant killed. S4 and S5 (exclusion anchoring) are an advisory.
**Gate**: all green.

**What works**:
- The portless bridge with exact validation, Host and token, and a 500 on failure.
- The exact CSP and the nonce.
- Only the packaged screen readable.
- No token in the page.
- The test API only in Test mode.
- SecretStorage for the key and global storage for the data.
- The host env reaching the core.
- Panel reuse.
- Guards against `vscode` imports and ports.
- The `.vsix`.

**Next steps**: optional advisory probe for the `.vscode-test` anchoring. The integration test needs `APP8N8_VSCODE_PATH` (or the `.vscode-test` download) until the installed VS Code finishes its update.
