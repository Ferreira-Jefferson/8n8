# Pasta limpa Validation

**Date**: 2026-10-15 (round 2)
**Spec**: `.specs/features/12-pasta-limpa/spec.md`
**Decision**: AD-027 in `.specs/STATE.md`
**Diff range**: `b798ae4..425c47d` (`c39b567` input gitignore, `de14d17` server include, `c276f94` history path-only, `655aaed` web icon, `6bc8f12` e2e, `80b9bbd` README/STATE, `425c47d` tests for the round 1 gaps)
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 12-pasta-limpa - PASS

Every AC (CLEAN-01..10) has a test that asserts the outcome the spec defines, and every mutant that maps to an AC is killed.

- **Round 1** (`80b9bbd`): 32 mutants, 27 killed, 5 survived (M02, M03, M05, M26, M32). The code was correct on every probe; the tests did not pin those outcomes.
- **Round 2** (`425c47d`, test-only commit): the 5 survivors, a new mutant on the 1024-character cap (M33), 9 round 1 kills as a regression sample, and M31 rerun. All 16 were killed. M02 also ran against the e2e test CLEAN-01/02 alone and survives there. This is informational: the unit test at `read-folder.test.ts` kills it.

No product defect was found in either round.

---

## Round 2 tests (`425c47d`)

| Gap | AC | New test |
| --- | -- | -------- |
| M02 | 01 | `packages/input/src/__tests__/read-folder.test.ts` "anchors a sub-folder's /pattern to that sub-folder, not to the root" (`lib/.gitignore` = `/local.py` → files `["lib/sub/local.py"]`) |
| M03 | 01 | `read-folder.test.ts` "never walks an ignored folder, so its own .gitignore cannot bring a file back" (→ files `["b.py"]`) |
| M05 | 06 | `packages/input/src/__tests__/read-file.test.ts` exactly 20 MB not added → `{reason:"too-large", addable:true}` |
| M26 | 06/07 | `apps/web/src/__tests__/App.test.tsx` "a second large file put on the map keeps the first one" → `projectMock(lojaRoot, ["a.py","b.py"])` and explain origin `{root, include:["a.py","b.py"]}` |
| M32 | 05 | `e2e/pasta-local.e2e.ts` "CLEAN-05: a long path wraps inside the list, and the list still ends before the panel" (`scrollWidth <= clientWidth`, path box inside the list, list ends before `panel.x`) |
| cap | 07 | `packages/server/src/__tests__/include-route.test.ts` 1025 characters → 400 on all 4 routes; exactly 1024 accepted |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| CLEAN-01 | Skips every file and folder that the root or a subfolder `.gitignore` ignores, with git rules (patterns, `!`, trailing `/`, leading `/`, `**`) | `packages/input/src/__tests__/read-folder.test.ts:304` root `gerado/`, `*.log.py`, `/so_na_raiz.py` (anchored at root only: `app/so_na_raiz.py` stays); `:320` subfolder `.gitignore` applies below it only, deeper `!` wins; `:336` `**/fixtures/**`, no `.gitignore` as before. E2E `e2e/pasta-local.e2e.ts:332` root + nested `.gitignore` with `!pedidos.py` | ✅ PASS (round 2: + nested anchored pattern and ignored-folder tests, `425c47d`) |
| CLEAN-02 | Skipped files never appear on the map nor in the ignored list | `read-folder.test.ts:304` `ignored: []` with `gerado/grande.py` > 1 MB; `e2e/pasta-local.e2e.ts:332` list is exactly `["grande.py"]` (gitignored `latin1.py` and `gerado/grande2.py` absent) | ✅ PASS |
| CLEAN-03 | README says 8n8 follows the folder's `.gitignore` and what else it skips | `packages/server/src/__tests__/readme.test.ts:15` section + sentence; `:22` every `IGNORED_DIRS` and plugin `ignoredDirs` named; `README.md:27-39` | ✅ PASS |
| CLEAN-04 | Warning icon, no text on the map, hover says "N arquivos ignorados" / "1 arquivo ignorado"; nothing when none | `apps/web/src/panel/__tests__/IgnoredFiles.test.tsx:23` empty → `innerHTML ""`; `:28` button name and tip `"4 arquivos ignorados"`, list closed; `:36` singular; E2E `e2e/pasta-local.e2e.ts:269` tip hidden, then visible on hover with the count | ✅ PASS |
| CLEAN-05 | Click opens a list with each file and reason, in a box that does not cover the detail panel; long paths wrap | `IgnoredFiles.test.tsx:48` paths and reasons in order, toggle closes; E2E `e2e/pasta-local.e2e.ts:296-299` `list.x + list.width <= panel.x` with the panel open | ✅ PASS (round 2: + long-path wrap e2e, `425c47d`) |
| CLEAN-06 | "Adicionar ao mapa" only for a file > 1 MB and ≤ 20 MB; the click asks the folder again with it; the file enters the map and leaves the list | `packages/input/src/__tests__/read-file.test.ts:123-141` added > 1 MB reads; exactly 20 MB added reads; 20 MB + 1 gives `addable: false`; `read-folder.test.ts:347` file moves from `ignored` to `files`; `IgnoredFiles.test.tsx:69` button only on `addable`, `onAdd("grande.py")`; `apps/web/src/__tests__/App.test.tsx:375` re-request with `["grande.py"]`, icon gone; `apps/web/src/__tests__/api.test.ts` "posts the files put on the map as include"; E2E `e2e/pasta-local.e2e.ts:302` body `{path, include:["grande.py"]}`, node `file:grande.py` visible, count drops to 1 | ✅ PASS (round 2: + 20 MB not-added boundary and second-add tests, `425c47d`) |
| CLEAN-07 | Summary, suggestions and titles carry `include`; the server accepts ≤ 100 relative paths, no `..`, `\`, leading `/`; 400 otherwise | `packages/server/src/__tests__/include-route.test.ts:49` 4 routes forward `include`; `:59` absent → `undefined`; `:68-91` 400 + nothing read for `..`, inner `..`, `\`, leading `/`, drive `C:`, empty, non-string, non-array, 101; `:93` exactly 100 accepted; `App.test.tsx:375` titles and explain origin `{root, include}`; `packages/server/src/__tests__/core.test.ts:804-821` `composeReadProject` passes `include` | ✅ PASS |
| CLEAN-08 | Folder: only path, name and numbers, never code or graph. Snippet: only text and language | `packages/server/src/__tests__/history.test.ts:105` the db and WAL bytes hold no code marker nor graph marker, and hold the path; `:212` `get` gives `{kind:"project",root}` and `{kind:"snippet",source,language}`; `:80` one row per path, sizes follow the last read; E2E `e2e/historico.e2e.ts:155` entry JSON is exactly `{kind,root}` | ✅ PASS |
| CLEAN-09 | Opening a folder re-reads it by path; gone → "Pasta não encontrada: <caminho>"; a snippet regenerates from text | `App.test.tsx:915`, `:932` `graphMock` called with the source; `:959` `projectMock("C:/codigo/loja", [])`; `:983` alert text exact; `packages/server/src/__tests__/history-route.test.ts:79` GET counts no visit; E2E `e2e/historico.e2e.ts:124` POST `/api/graph` body `{source}`, same level ids; `:155` POST `/api/project` body `{path}`, same level ids, then deleted folder → alert, 0 nodes | ✅ PASS |
| CLEAN-10 | Migration drops all stored code and graphs, one row per folder path (the last opened), favourites kept | `history.test.ts:239` v2 file: rows `[5,true],[4,false],[2,true]` (latest of `/r/loja`, starred because row 1 was); textless snippet dropped; same folder/snippet hit the migrated rows; only table `search` left; old blob absent from the file after `VACUUM`; `:161` v1 file still migrates | ✅ PASS |

---

## Discrimination Sensor

### Round 1 (`80b9bbd`)

Run in an isolated worktree (`git worktree add --detach <scratchpad>/wt12 HEAD`, `pnpm install --offline --frozen-lockfile`). Unit mutants ran the package's Vitest files; e2e mutants rebuilt `apps/web` and `apps/cli` and ran one `e2e/pasta-local.e2e.ts` test. The e2e baseline (the 3 CLEAN tests) passed before mutating. Main repo `git status --porcelain` was empty before and after; the worktree was removed and pruned.

| # | Mutant (file) | AC | Tests run | Result |
| - | ------------- | -- | --------- | ------ |
| M01 | deeper `!` no longer un-ignores (`read-folder.ts` `gitignored`) | 01 | input | Killed |
| M02 | nested `.gitignore` judges the path from the root, not from its own folder | 01 | input + e2e CLEAN-01/02 | **Survived** |
| M03 | a folder is tested without the trailing `/` (ignored folders are walked, their own `.gitignore` read) | 01 | input | **Survived** |
| M04 | only the root `.gitignore` is read | 01 | input | Killed |
| M05 | `addable` when `size < 20 MB` instead of `<=` (`read-file.ts`) | 06 | input | **Survived** |
| M06 | the `added` flag no longer lifts the 1 MB limit | 06 | input | Killed |
| M07 | `..` allowed in `include` (`app.ts`) | 07 | include-route | Killed |
| M08 | `\` allowed | 07 | include-route | Killed |
| M09 | `:` allowed | 07 | include-route | Killed |
| M10 | leading `/` allowed | 07 | include-route | Killed |
| M11 | `.max(101)` | 07 | include-route | Killed |
| M12 | summary/suggestions drop `include` | 07 | include-route | Killed |
| M13 | titles drop `include` | 07 | include-route | Killed |
| M14 | `/api/project` drops `include` | 06 | include-route | Killed |
| M15 | GET `/api/history/:id` counts a visit | 09 | history-route | Killed |
| M16 | `composeReadProject` drops `include` (`core.ts`) | 06 | core | Killed |
| M17 | a folder row stores its whole response (`history.ts`) | 08 | history* | Killed |
| M18 | no `VACUUM` after migration | 10 | history* | Killed |
| M19 | no favourite propagation in the dedupe | 10 | history* | Killed |
| M20 | dedupe keeps the oldest row of a path | 10 | history* | Killed |
| M21 | `search_data` kept | 10 | history* | Killed |
| M22 | folder key hashes its code (one row per code) | 08 | history* | Killed |
| M23 | textless snippet kept | 10 | history* | Killed |
| M24 | singular text "1 arquivos ignorados" (`IgnoredFiles.tsx`) | 04 | web | Killed |
| M25 | button on every `too-large` file, ignoring `addable` | 06 | web | Killed |
| M26 | "Adicionar ao mapa" sends `[path]`, dropping files added before (`App.tsx`) | 06/07 | web | **Survived** |
| M27 | `originOf` drops `include` | 07 | web | Killed |
| M28 | `openEntry` does not re-read the folder | 09 | web | Killed |
| M29 | list open by default | 04/05 | web | Killed |
| M30 | `fetchProject` drops `include` (`api.ts`) | 06 | web | Killed |
| M31 | `.ignored-list` width 3000px (covers the panel, `styles.css`) | 05 | e2e CLEAN-04/05 | Killed |
| M32 | `.ignored-path` `white-space: nowrap` instead of `overflow-wrap: anywhere` | 05 | e2e CLEAN-04/05 | **Survived** |

Probes for M02, M03 and M05 (a temporary test file in the worktree, deleted): each probe passed on HEAD and failed on its mutant. So these three survivors are real behaviour changes, not equivalent mutants.

---

### Round 2 (`425c47d`)

The worktree was `C:/w12` (a short path, so the Windows MAX_PATH limit did not bite), set up with `pnpm install --offline --frozen-lockfile`. HEAD baselines were green: input 41/41, server include-route + history files 72/72, web CLEAN files 122/122, and e2e `pasta-local` CLEAN tests 4/4.

| # | Mutant | AC | Tests run | Result |
| - | ------ | -- | --------- | ------ |
| M02 | nested `.gitignore` judged from the root | 01 | input | Killed |
| M02e | same, e2e only | 01 | e2e CLEAN-01/02 | Survived (informational; the unit test kills it) |
| M03 | folder tested without trailing `/` | 01 | input | Killed |
| M05 | `addable` at `< 20 MB` | 06 | input | Killed |
| M26 | second add sends only `[path]` | 06/07 | web App | Killed |
| M32 | `.ignored-path` `white-space: nowrap` | 05 | e2e "CLEAN-05: a long path" | Killed |
| M33 | `include` path cap `.max(1025)` | 07 | include-route | Killed |
| M01, M06, M07, M13, M18, M20, M27, M28 | round 1 kills, rerun as a regression sample | 01, 06, 07, 10, 07, 10, 07, 09 | as round 1 | All killed |
| M31 | `.ignored-list` width 3000px | 05 | e2e CLEAN-04/05 | Killed |

Main repo `git status --porcelain` matched the pre-sensor baseline before and after: only this file and `spec.md`. The worktree is unregistered (`git worktree list` shows only master). `git worktree remove` could not delete every file under `C:/w12`, so the folder is still on disk (about 263 MB) and needs a manual delete.

---

## Gaps (ranked)

Round 2 closed all 5 round 1 gaps (see "Round 2 tests" above). The list below is the round 1 record.

1. **M02, CLEAN-01: nested `.gitignore` with an anchored pattern.** Add a test to `packages/input/src/__tests__/read-folder.test.ts`: `lib/.gitignore` = `/local.py`, files `lib/local.py` and `lib/sub/local.py` → files `["lib/sub/local.py"]`. The spec names "`/` no começo" for any `.gitignore`. Today only the root one is tested.
2. **M03, CLEAN-01: an ignored folder is not entered.** Add: root `.gitignore` = `gerado/`, `gerado/.gitignore` = `!a.py`, files `gerado/a.py` and `b.py` → files `["b.py"]`. This matches git's rule that a file inside an excluded folder cannot be re-included. It also guards against walking `node_modules`-sized ignored folders.
3. **M26, CLEAN-06/07: a second "Adicionar ao mapa" keeps the first.** Add to `apps/web/src/__tests__/App.test.tsx` (next to `:375`): two addable files; add one, then the other → `projectMock` last called with `(lojaRoot, ["a.py", "b.py"])`, and the explain/titles origin carries both.
4. **M05, CLEAN-06: boundary at exactly 20 MB without `added`.** Add to `packages/input/src/__tests__/read-file.test.ts:123` block: a 20 MB file read with `added = false` → `{ reason: "too-large", addable: true }`.
5. **M32, CLEAN-05: long paths wrap.** In `e2e/pasta-local.e2e.ts:269` (or a new fixture), use an ignored file with a long path (for example a 200-char nested path > 1 MB). Assert the `.ignored-path` box width ≤ the list width, and the list still ends before `panel.x`.

Spec precision notes (no action needed for PASS):

- CLEAN-07 lists `..`, `\` and leading `/`. The code also refuses `:`, empty strings and paths over 1024 chars. These are stricter than the spec. `:` is recorded in AD-027. `:`, the empty string and the 1024-char cap are tested (`include-route.test.ts`, the cap since `425c47d`).
- CLEAN-08 says a snippet keeps "só o texto e a linguagem", but a snippet row also keeps the title and the size numbers that the list shows. The intent (no graph, no other code) holds. The wording could name the list numbers for snippets too.
- CLEAN-04 "sem texto sobre o mapa" is checked only indirectly: the tip is hidden until hover (`e2e/pasta-local.e2e.ts:281`).

## Gates

- Round 1 (`80b9bbd`): input 39/39, server CLEAN files 71/71 (+ core 34/34), web CLEAN files 121/121; e2e `pasta-local` CLEAN tests 3/3. All green on HEAD in the worktree.
- Round 2 (`425c47d`): input 41/41, server include-route + history 72/72, web CLEAN files 122/122; e2e `pasta-local` CLEAN tests 4/4. All green on HEAD in `C:/w12`.
- The full e2e suite (145 passed) was reported by the author and was not re-run by the Verifier.
