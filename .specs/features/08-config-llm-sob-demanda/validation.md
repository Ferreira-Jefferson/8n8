# Validation: 08-config-llm-sob-demanda - PASS ✅

**Verdict**: PASS ✅ (round 2, range `172fe53..dba6920`)
**Reason**: all 25 ACs match the spec with `file:line` evidence. Every gate is green. All 16 mutants of round 2 are killed, including the round-1 survivors (atomic write, mode 600, route 400). The Windows `EPERM` on the settings rename is fixed, and the e2e specs it broke passed 5 runs in a row.

**Date**: 2026-10-15
**Spec**: `.specs/features/08-config-llm-sob-demanda/spec.md` (CFG-09 amended in `dba6920`)
**Diff range**: `172fe53..dba6920` (16 commits, feature starts at `080416e`)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T13 | ✅ Done | `tasks.md`: no unchecked item |
| Fix `dba6920` | ✅ Done | Closes the 6 gaps of round 1 |

---

## Round-1 Gaps: Re-check

| # | Gap | Evidence now | Result |
| - | --- | ------------ | ------ |
| 1 | Windows `EPERM` on `rename` | `packages/server/src/settings-file.ts:39-60` (retry on EPERM/EACCES/EBUSY, 10 tries); `packages/server/src/__tests__/settings-file.test.ts:134`, `:153`, `:171`; `configuracoes` + `cli` e2e 5/5 runs green | ✅ Closed |
| 2 | Atomic write untested (M15) | `settings-file.test.ts:107` (write to `config.json.<uuid>.tmp`, then `rename` to `config.json`), `:117` (old file whole after a failed write) | ✅ Closed |
| 3 | Route 400 untested (M22) | `packages/server/src/__tests__/settings-route.test.ts:50-65` (`res.status` 400, body `{error:"invalid settings"}`, no write), `:67-83` (500, no key in body or log) | ✅ Closed |
| 4 | Mode 600 only off Windows (M14) | `settings-file.test.ts:107` (`write ... .tmp 600` on every platform) | ✅ Closed |
| 5 | CFG-09 timing | spec CFG-09 now says the notice shows on a request without `cachedOnly`; matches `e2e/configuracoes.e2e.ts:84-92` | ✅ Closed |
| 6 | Editor button untested | `apps/web/src/__tests__/App.test.tsx:1116-1124` | ✅ Closed |

The new route test also found a leak: the 500 log printed the store's error message, which can carry the key. `packages/server/src/app.ts` now logs only the error code; `settings-route.test.ts:81` guards it (mutant N29 killed).

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| CFG-01 | `POST /api/summary`: summary, inputs, outputs only; ok/unfaithful/no-key/error | `packages/explain/src/__tests__/explain.test.ts:176`; `packages/explain/src/__tests__/review.test.ts:265`; `packages/server/src/__tests__/explain-route.test.ts:64-110`, `:157-197` | ✅ PASS |
| CFG-02 | Suggestions only, max 5, empty after review = `ok` | `explain.test.ts:557`, `:605`, `:833`; `review.test.ts:247` | ✅ PASS |
| CFG-03 | Separate prompts; no docstring block for the summary; stale docstring = first suggestion | `packages/explain/src/__tests__/prompt.test.ts:63`, `:90`; `explain.test.ts:759`, `:771`, `:800`, `:844`; `e2e/docstring.e2e.ts:80` | ✅ PASS |
| CFG-04 | `<cache>/nodes`, `<cache>/suggestions`; summary fingerprint without docstring; old version absent | `packages/explain/src/__tests__/cache.test.ts:71`, `:148`, `:165`; `explain.test.ts:359`, `:438`, `:782` | ✅ PASS |
| CFG-05 | `cachedOnly` → hit or `not-cached`, no LLM call | `explain.test.ts:512`; `explain-route.test.ts:73` | ✅ PASS |
| CFG-06 | Auto off → `cachedOnly: true`; hit with no click; miss → button | `apps/web/src/panel/__tests__/DetailPanel.test.tsx:870`, `:893`; `e2e/configuracoes.e2e.ts:72-82`, `:110-115` | ✅ PASS |
| CFG-07 | Click → real request, loading text, result | `DetailPanel.test.tsx:911`, `:939`; `e2e/configuracoes.e2e.ts:117-124` | ✅ PASS |
| CFG-08 | Auto on → real request on selection | `DetailPanel.test.tsx:973`; `apps/web/src/__tests__/App.test.tsx:1077`; `e2e/configuracoes.e2e.ts:134-157` | ✅ PASS |
| CFG-09 | (amended) On a real request with no provider: the notice + a button that opens the settings | `DetailPanel.test.tsx:993`; `App.test.tsx:1101`; `e2e/configuracoes.e2e.ts:84-92` | ✅ PASS |
| CFG-10 | Suggestions feed cards and count; a summary never creates a card | `DetailPanel.test.tsx:347`, `:1011`; `App.test.tsx:196` (`onSuggestions` takes `Suggestion[]`: the types forbid a summary) | ✅ PASS |
| CFG-11 | Empty → "Nenhuma sugestão para este nó." | `DetailPanel.test.tsx:1011`; `e2e/configuracoes.e2e.ts:148-150` | ✅ PASS |
| CFG-12 | GET: effective fields, providers, `hasKey`, env names; never the key | `packages/server/src/__tests__/settings.test.ts:41-75`; `settings-route.test.ts:86-105`; `packages/server/src/__tests__/security.test.ts:264`; `e2e/configuracoes.e2e.ts:166-171` | ✅ PASS |
| CFG-13 | PUT stores fields, answers the GET body; `null` erases | `settings.test.ts:127-161`; `settings-route.test.ts:40-48`; `apps/web/src/__tests__/api.test.ts:211` | ✅ PASS |
| CFG-14 | Invalid field/provider/URL/empty key → 400, nothing stored | `settings-route.test.ts:50-65` (`expect(res.status).toBe(400)`, `writes` `[]`); `settings.test.ts:163-180` | ✅ PASS |
| CFG-15 | Provider/URL change erases the key; provider change erases URL and model | `settings.test.ts:200-238`; `e2e/configuracoes.e2e.ts:183-191` | ✅ PASS |
| CFG-16 | Env > stored > default; stored fields only for the stored provider | `packages/llm/src/__tests__/config.test.ts:143-202` | ✅ PASS |
| CFG-17 | New config on the next request, no restart | `settings.test.ts:242-271`; `security.test.ts:207-215` + `:277`; `e2e/configuracoes.e2e.ts:95-124` | ✅ PASS |
| CFG-18 | Core gets `settings` in `CoreOptions`; reads no env or file itself | `packages/server/src/core.ts:258`; `packages/server/src/__tests__/core.test.ts:860-872`; `pnpm check` (dependency-cruiser) | ✅ PASS (structural) |
| CFG-19 | `<APP8N8_CONFIG_DIR or ~/.8n8>/config.json`, temp + rename, `0o600`, bad file = empty | `settings-file.test.ts:23-65`, `:107`, `:117`; `apps/cli/src/__tests__/run.test.ts:251-284` | ✅ PASS |
| CFG-20 | Button on start, editor, map; dialog fields; "Chave guardada"; "Apagar chave"; two checkboxes | `apps/web/src/settings/__tests__/SettingsDialog.test.tsx:48`, `:65`; `App.test.tsx:1069`, `:1116`; `e2e/configuracoes.e2e.ts:56`, `:162` | ✅ PASS |
| CFG-21 | Only changed fields; "Configurações salvas."; 400 → error text, typed values kept | `SettingsDialog.test.tsx:104`, `:121`, `:135`; `e2e/configuracoes.e2e.ts:194-210` | ✅ PASS |
| CFG-22 | Env-set field disabled, "Definido pela variável <NOME>" | `SettingsDialog.test.tsx:144`; `settings.test.ts:77-98`; `e2e/configuracoes.e2e.ts:178-181` | ✅ PASS |
| CFG-23 | Sentinel key via PUT never in any body/header, whole or prefix, incl. provider error | `security.test.ts:158-279`; `settings-route.test.ts:46`, `:79-81` | ✅ PASS |
| CFG-24 | GET/PUT `/api/settings` attacked like other routes; a double proves no write | `security.test.ts:47-57`, `:81-145` | ✅ PASS |
| CFG-25 | `0o600` on Linux/macOS; the terminal never shows the stored key | `apps/cli/src/__tests__/run.test.ts:286-308`; `settings-file.test.ts:107` (mode on every platform) | ✅ PASS |

**Status**: ✅ All ACs covered, no spec-precision gap left.

---

## Discrimination Sensor

Scratch: a detached `git worktree` of `dba6920` with its own `pnpm install --offline`. Each mutant was applied alone, the owning package's whole Vitest suite was run, and the file was restored. Depth: P0 (settings and the key).

Round 1 (`6ae2d26`, 23 mutants): 20 killed. M15 (no temp + rename) and M22 (400→500) survived; M14 (no `0o600`) was platform-limited.

Round 2 (`dba6920`):

| # | File | Mutation | Killed? |
| - | ---- | -------- | ------- |
| M1 | `packages/server/src/settings.ts:157` | GET view carries the key | ✅ Killed (6 tests) |
| M2 | `packages/server/src/settings.ts:98` | a URL change keeps the key | ✅ Killed |
| M4 | `packages/llm/src/config.ts:310` | stored fields applied to any provider | ✅ Killed |
| M8 | `packages/server/src/settings.ts:215` | provider error not scrubbed | ✅ Killed |
| M11 | `packages/explain/src/explain.ts:171` | `cachedOnly` calls the LLM | ✅ Killed |
| M12 | `packages/explain/src/explain.ts:103` | the summary gets the docstring | ✅ Killed |
| M16 | `apps/web/src/panel/DetailPanel.tsx:263` | panel asks for real with auto off | ✅ Killed |
| M22 | `packages/server/src/app.ts` PUT handler | 400 → 500 | ✅ Killed (5 tests) |
| N14 | `packages/server/src/settings-file.ts:88` | no `mode: 0o600` | ✅ Killed (on Windows) |
| N15 | `packages/server/src/settings-file.ts:84` | write in place, no temp | ✅ Killed |
| N24 | `packages/server/src/settings-file.ts:56` | no retry on a busy rename | ✅ Killed |
| N25 | `packages/server/src/settings-file.ts:56` | retries every error code | ✅ Killed |
| N26 | `packages/server/src/settings-file.ts:39` | EACCES not retried | ✅ Killed |
| N27 | `packages/server/src/settings-file.ts:92` | temp file kept after giving up | ✅ Killed |
| N28 | `packages/server/src/settings-file.ts:40` | 11 tries instead of 10 | ✅ Killed |
| N29 | `packages/server/src/app.ts` 500 log | logs the error message (key leak) | ✅ Killed |

**Result**: 16/16 killed - PASS ✅
**Isolation**: real-tree `git status --porcelain` matched the baseline before and after (only this report and the lessons files differ, written by the Verifier). Worktree removed and pruned.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ |
| No scope creep | ✅ (`FileOps` exists only so tests can inject failures) |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ |
| Per-layer coverage (routes happy + edge + error) | ✅ `settings-route.test.ts` covers 200, 400, 404, 500 |
| Every test maps to a requirement | ✅ |
| Documented guidelines followed: `CLAUDE.md`, `CONTRIBUTING.md` | ✅ |

---

## Failure Paths

- [x] CFG-14: 400 `{error:"invalid settings"}`, distinct from the 200 view (`settings-route.test.ts:61-62`)
- [x] CFG-05: `not-cached` is distinct from `no-key` (`explain.test.ts:512`)
- [x] CFG-09: `no-key` has its own text and button
- [x] CFG-19: a failed write keeps the old file and leaves no temp (`settings-file.test.ts:117`, `:153`)
- [x] CFG-21: the refusal keeps the typed value (`SettingsDialog.test.tsx:121`)
- [x] CFG-23: a hostile provider error reaches the client as `status: error`, with no key

---

## Gate Check

- `pnpm test`: exit 0. 1793 passed, 2 skipped (the `statSync` `0o600` checks, `skipIf(win32)`; the mode is now also checked on every platform at `settings-file.test.ts:107`)
- `pnpm typecheck`: exit 0
- `pnpm check`: exit 0 (Biome 343 files; dependency-cruiser, no violations)
- `pnpm --filter @8n8/cli build`: exit 0
- `pnpm exec playwright test e2e/configuracoes.e2e.ts e2e/cli.e2e.ts`: 5 runs in a row, 12/12 passed each time (60/60)
- Full `pnpm e2e`: 141/141 at `6ae2d26`. `dba6920` touches no e2e file and no code the other specs reach, apart from the settings store, which the targeted specs cover.
- Test count: +14 since round 1 (server +13, web +1). No test removed.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| CFG-01..25 | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 25/25 ACs matched the spec outcome
**Sensor**: round 2, 16/16 killed
**Gate**: 1793 unit passed; typecheck 0; check 0; targeted e2e 60/60; full e2e 141/141

**What works**:
- The key never leaves through a route, a provider error or the server log.
- A URL or provider change erases the stored key.
- Stored fields never reach another provider.
- `cachedOnly` never calls the LLM.
- The summary never sees the docstring.
- The settings save survives a file that Windows holds for a moment.

**Known limit**: `EACCES` is retried for about 1 s before the save fails, so a real permission error is reported about 1 s late. This is acceptable.
