# 02-pasta-local Validation

**Date**: 2026-10-13
**Spec**: `.specs/features/02-pasta-local/spec.md` (PROJ-01..09 and the Independent Test, as settled in `076cf10`)
**Diff range**: the feature is `775a28a..75f9230` without the feature-04 commits (`51d4b12`, `890dfe3`, `1a68e4e`, `b9483a1`, `81cc767`, `60c6243`, `2a60114`, `7895637`). This iteration re-checks the fixes in `ffe0a66..75f9230`: `076cf10` (spec) and `159178b`, `755550f`, `d4c105a`, `679e890`, `f18259c`, `75f9230` (tests only).
**Iteration**: 2 of 3
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 02-pasta-local - FAIL ❌

All 9 ACs have `file:line` evidence that targets the exact spec outcome. The full gate is green: 475 unit tests and 31 E2E tests. All 7 mutants that survived iteration 1 are now killed. The verdict is still FAIL, because 3 of the 14 new mutants survive, and each one changes a spec outcome:

- **N10 (PROJ-03)**: an `import b` resolved through the caller's folder (script style) loses its import wire.
- **N12 (PROJ-03)**: a `from . import b` loses its import wire.
- **N13 (PROJ-01)**: `.pyi` and `.pyc` files enter the map, or the ignored list.

The production code is correct in all three cases, and a probe shows each mutant is not equivalent. The fixes add tests only.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T32 | ✅ Done (32/32 `✅ Complete`) | The checkmarks were not trusted. Every AC below is re-derived from the code and the tests at `75f9230`. |
| Iteration-1 fixes 1–5 | ✅ Landed | Each one was checked by its own mutant in the sensor below. |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| PROJ-01 | Every `.py` file in the folder and its subfolders is read, except under the 8 named folders `.git`, `.venv`, `venv`, `node_modules`, `__pycache__`, `site-packages`, `build`, `dist` | `packages/input/src/__tests__/read-folder.test.ts:88-99`: the loop over all 8 names, `all.some((p) => p.includes(bad))` `toBe(false)`. The tree has one file under each name, at depth 0 or 1 (`:29-37`). `:106-111`: `files` `toEqual(["B.py","_x.py","a.py","pedidos/itens.py"])`. `packages/server/src/__tests__/main.test.ts:288`: `files` `toHaveLength(8)`. `e2e/pasta-local.e2e.ts:249`: no `x.py` or `y.py` text | ⚠️ Outcome matched. Test gap: N13 survives, because no test has a `.pyc` or `.pyi` file |
| PROJ-02 | One node per folder at the top level, one node per file inside each folder, and root files under "raiz" | `packages/extract-python/src/__tests__/project.test.ts:14`: exact `[id, kind, label, path, parentId]` for the 12 folder and file nodes. `e2e/pasta-local.e2e.ts:100`: top level `toEqual(["dir:.","dir:frete","dir:legado","dir:pedidos"])`. `:106`: labels. `:116`: the 3 files of `pedidos`. `:130`: `raiz` holds `main.py` and `relatorio.py` | ✅ PASS |
| PROJ-03 | A file that imports another file of the root gets an import wire to it | `project.test.ts:225-242`: `importIds` `toEqual` the 4 exact edges. `:244`, `:254`, `:263`, `:271`: submodule, `__init__`, outside the root, self and duplicate. `e2e/pasta-local.e2e.ts:139-155`: 2 wires `edge-imports` at the top, and `pedidos.py→itens.py` inside `pedidos` | ⚠️ Outcome matched for the fixture. Test gap: N10 and N12 survive. Two supported import forms have no wire test: the caller's folder (script style) and `from . import x` |
| PROJ-04 | A call through a resolved import to another file's function gets a call wire between the two functions | `project.test.ts:113-130`: a `call` step labelled `calcular_frete` targets `file:frete/calculo.py/fn:calcular_frete`, and the `calls` edge exists, through the `frete/__init__.py` re-export. `:132`: `main → processar_pedido`. `apps/web/src/__tests__/App.test.tsx:336`. `e2e/pasta-local.e2e.ts:176-186`: the step jumps, and the breadcrumb is `loja › frete › calculo.py › calcular_frete` | ✅ PASS |
| PROJ-05 | A path that does not exist, or is not a folder, shows `Pasta não encontrada: <caminho>` | `read-folder.test.ts:121-128`: `{kind:"not-found"}` for a missing path and for a file. `packages/server/src/__tests__/project-route.test.ts:52-59`: `404 {error:"not-found", path}`, with the path as typed. `App.test.tsx:237-245`: the alert `toBe("Pasta não encontrada: C:\\nao\\existe")`. `e2e/pasta-local.e2e.ts:231`: `toHaveText(\`Pasta não encontrada: ${path}\`)` for both cases | ✅ PASS |
| PROJ-06 | Ignored files show as `<caminho> — <motivo>`, with exactly 4 reason texts. The boundary is 1 048 576 bytes: that size is read, and 1 byte more is ignored | `packages/input/src/__tests__/read-file.test.ts:27-34`: 1 048 576 bytes `ok`. `:38-43`: 1 048 577 bytes `too-large`. `:47-52`: `not-utf8`. `:69-77`: `EACCES` gives `unreadable`. `:81-111`: `symlink`. `apps/web/src/panel/__tests__/IgnoredFiles.test.tsx:31`: all 4 exact texts. `main.test.ts:289`. `e2e/pasta-local.e2e.ts:245-246`: `"grande.py — maior que 1 MB"`, `"latin1.py — não está em UTF-8"` | ✅ PASS |
| PROJ-07 | The system only reads. It never writes, moves or executes files of the folder | `packages/input/src/__tests__/read-only.test.ts:53-65`: the write-API scan, and only `fs-read.ts` imports `node:fs`. `read-folder.test.ts:153-160`: a fresh tree, snapshotted before its first read (path, size, `mtimeMs`, sha256) `toEqual(before)`. `main.test.ts:328-333`. `e2e/pasta-local.e2e.ts:255-292`: a fresh copy, `fingerprint(loja)` `toEqual(before)` | ✅ PASS (the iteration-1 test-order issue Q-1 is fixed, see M4b) |
| PROJ-08 | Listen only on IPv4 `127.0.0.1`. `localhost` works when it resolves to that address. `::1` and external interfaces are not listened on | `main.test.ts:400-403`: `listenOptions(4317)` `toEqual({port:4317, hostname:"127.0.0.1"})`, used by `serve` at `packages/server/src/main.ts:109`. `e2e/pasta-local.e2e.ts:310`: `outcome` `toBe("ECONNREFUSED")` on the external IPv4. It ran in this gate. The Host guard allows `127.0.0.1:<port>` and `localhost:<port>` (`packages/server/src/app.ts:36`), and `project-route.test.ts:72` gives 403 for a foreign Host | ✅ PASS |
| PROJ-09 | A same-name call resolves through the caller's import. With no import, it is EXTERNO. A dotted call to an unimported project module gets no call wire | `project.test.ts:145-152`: `relatorio.py/fn:gerar` has exactly `[["external","calcular_frete","EXTERNO"]]`. `:155-163`: no edge targets `legado/frete_antigo.py`. `packages/extract-python/src/__tests__/project-calls.test.ts:73-78`: EXTERNO. `:81-87`: `frete.calcular_frete()` with no `import frete`, with a resolver that would hit, `toBeNull()`. `e2e/pasta-local.e2e.ts:209`, `:223` | ✅ PASS |
| Independent Test | `pedidos/` and `frete/` give two folder nodes and an import wire. Opening `pedidos`, the call wire reaches `calcular_frete` | `e2e/pasta-local.e2e.ts:133-156` and `:158-191` | ✅ PASS |

**Status**: 9/9 ACs matched the spec outcome. There are no spec-precision gaps: `076cf10` settled SP-1..4 in the spec text. 3 sensor survivors remain (N13 on PROJ-01; N10 and N12 on PROJ-03).

### Cross-cutting decisions (STATE.md)

| Decision | Evidence | Result |
| -------- | -------- | ------ |
| AD-013 (IDs `dir:`, `file:`, POSIX, code-unit order) | `project.test.ts:14` exact IDs. `:167` gives the same graph twice and with the files reversed. `read-folder.test.ts:106` code-unit order | ✅ |
| AD-014 (`input` is read-only and depends only on `model`) | `read-only.test.ts:53-65`. The dependency-cruiser rule `input-only-model` passes in `pnpm check` | ✅ |
| AD-015 (`{root,nodeId}`, re-read from disk, identity `<real POSIX root>\|<id>`, neighbour `<path>:<label>`) | `project-route.test.ts:145` `nodeId` `C:/tmp/loja\|…`. `main.test.ts:346`: a line added to the file on disk reaches the explain call. `main.test.ts:349-395`: the same folder typed as is, with `..` and a trailing separator, and through a junction gives one cache entry (`:395`) and one draft, and the later two answers are `fromCache: true` (`:392-393`). `project-route.test.ts:168`: client `source` and `code` are ignored | ✅ |
| AD-016 (415 for any non-JSON POST) | `packages/server/src/__tests__/json-only.test.ts:40` `text/plain`. `:57-69`: a byte body, with `content-type` asserted `toBeNull()`. `:72-94`: `x-www-form-urlencoded` and `multipart/form-data` on all 3 routes, each `toBe(415)`, and nothing runs | ✅ |

### Regression (features 01 and 04)

- `e2e/fatia-central.e2e.ts` passes 14/14. `e2e/fidelidade.e2e.ts` passes 4/4, and `e2e/cache.e2e.ts` passes 4/4.
- The explain suite passes 129/129, and the model suite passes 22/22.
- No assertion in feature 01 or 04 changed in `ffe0a66..75f9230`.
- `75f9230` adds `apps/web/src/__tests__/setup.tsx`, a jsdom warm-up `beforeAll`. It contains no assertion. It only takes the cold-start cost (flagged in iteration 1) out of the first test of each file.

---

## Discrimination Sensor

**Setup.** The sensor ran in a scratch `git worktree` at `HEAD 75f9230`, with LF line endings (`core.autocrlf=false`), under the session scratchpad.

**Method.**

- Each mutant is an exact-match text substitution. Each one ran against its package's `vitest run`. The PROJ-07 mutant also ran against the Playwright test `e2e/pasta-local.e2e.ts:252`.
- Each mutant was reverted with `git checkout`, and the scratch was checked clean after every run.
- A survivor was then checked with a throwaway probe test in the scratch. The probe passes on the original and fails on the mutant, so the mutant is not equivalent.

**Cleanup.** The worktree was removed afterwards. The real tree's `git status --porcelain` was ` M .specs/STATE.md` before the sensor and after it: they match.

### Iteration-1 survivors (re-run)

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| M1a | `packages/input/src/read-folder.ts:7` | Drop `.git` from `IGNORED_DIRS` | ✅ Killed by `read-folder.test.ts:98` and `:106` |
| M1b | `read-folder.ts:12` | Drop `site-packages` | ✅ Killed by `read-folder.test.ts:98` and `:106` |
| M1d | `read-folder.ts:9` | Drop `venv` | ✅ Killed by `read-folder.test.ts:98` and `:106` |
| M11 | `packages/server/src/app.ts:52` | 415 only for `text/plain` (a denylist) | ✅ Killed by `json-only.test.ts:67` and `:91` |
| M13 | `app.ts:111` | Cache identity from the typed `root`, not the real path | ✅ Killed by `main.test.ts:392` |
| M7b | `packages/extract-python/src/calls.ts:61` | Ask the project resolver even when the head was never imported | ✅ Killed by `project-calls.test.ts:87` |
| M4b (PROJ-07) | `packages/input/src/read-file.ts:24` and `fs-read.ts:2` | `utimes(abs, 0, 0)` after each read (an idempotent write) | ✅ Killed in its own layer by `read-folder.test.ts:159`. Also killed by `e2e/pasta-local.e2e.ts:292` (`mtimeMs` `…` → `0`) |

### New mutants (iteration 2)

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| N1 | `read-folder.ts:41` | Drop the `isDirectory()` check (a file path is accepted, PROJ-05) | ✅ Killed by `read-folder.test.ts:125` |
| N2 | `read-file.ts:23` | `size > MAX` → `size > MAX + 1` (the boundary moves up by one, PROJ-06) | ✅ Killed by `read-file.test.ts:43`, `read-folder.test.ts:106` and `:133` |
| N13 | `read-folder.ts:56` | `endsWith(extension)` → `includes(extension)` (PROJ-01) | ❌ **Survived** (input + server). Probe: `stub.pyi` enters `files`, and `a.pyc` enters `ignored` as `not-utf8` |
| N3 | `packages/extract-python/src/modules.ts:90-92` | Stop following a re-export in `__init__.py` (PROJ-04) | ✅ Killed by `modules.test.ts:37` and `project.test.ts:113` |
| N4 | `modules.ts:9` | `a/b/__init__.py` named `a.b.__init__` | ✅ Killed by `modules.test.ts:118`, `project.test.ts:225` and `extractor.test.ts:34` |
| N5 | `calls.ts:63` | A project call step loses its label as written (PROJ-04) | ✅ Killed by `project-calls.test.ts:35`, `build-graph-prefix.test.ts:57` and `project.test.ts:113` |
| N10 | `packages/extract-python/src/project.ts:162` | Import wires stop falling back to the caller's folder (`[absolute]` only, PROJ-03) | ❌ **Survived**. Probe: `scripts/a.py` with `import b`, and `scripts/b.py`. The mutant gives `imports: []`, but it keeps the `calls` wire `a.f → b.g`, so the two kinds of wire disagree |
| N12 | `project.ts:146` | `from . import b` is joined as `..b` (the joiner is always `.`) (PROJ-03) | ❌ **Survived**. Probe: `pedidos/a.py` with `from . import b`, and `pedidos/b.py`. The mutant gives `imports: []`. This is the risk the design names ("`from . import x` gera `..x`"). `imports.test.ts:43` covers it only for aliases, not for wires |
| N6 | `app.ts:102` | Explain takes the code of `files[0]`, not the node's file (AD-015) | ✅ Killed by `main.test.ts:346` |
| N7 | `packages/server/src/main.ts:71` | `composeReadProject` returns `ignored: []` (PROJ-06) | ✅ Killed by `main.test.ts:289` |
| N8 | `apps/web/src/panel/IgnoredFiles.tsx:7` | `symlink` text → "link simbólico" (PROJ-06) | ✅ Killed by `IgnoredFiles.test.tsx:31` |
| N9 | `apps/web/src/nav/Breadcrumb.tsx:16` | The breadcrumb always starts with "Trecho" | ✅ Killed by `Breadcrumb.test.tsx:63`, `App.test.tsx:221` and `:336` |
| N11 | `apps/web/src/flow/project-level.ts:68` | A lifted wire onto one node is kept (a self-loop on a folder) | ✅ Killed by `project-level.test.ts:86` and `:158` |
| N14 | `apps/web/src/App.tsx:158` | Empty-folder text → "Nenhum arquivo encontrado." | ✅ Killed by `App.test.tsx:250` |

**Sensor depth**: P0-style. The feature reads arbitrary local paths, and the sensor covered input, extract-python, server and web.
**Result**: 21 mutants: 18 killed and 3 survived (N10, N12, N13). All 7 iteration-1 survivors are killed. **FAIL ❌**

### Why each survivor matters

- **N13 (PROJ-01)**:
  - The spec says "arquivos `.py`". A substring match would read `.pyi` stubs into the map. It would also list every stray `.pyc` file outside `__pycache__` under "Arquivos ignorados" as "não está em UTF-8".
  - `read-folder.test.ts:114-119` only checks `notas.txt`, which no match form accepts.
- **N10 (PROJ-03)**:
  - The design orders the resolution "raiz, depois pasta do script". `modules.test.ts:68-84` tests that order for call resolution (`resolveName`), but not for import wires (`deepestModule`).
  - A script-style project would show call wires between files with no import wire under them.
- **N12 (PROJ-03)**:
  - `from . import x` is the common form inside a package. Under the mutant, it gets no wire.
  - The design lists this exact risk, and promises a dedicated test. That test exists only for `importAliases`, not for `importedNames`.

---

## Gate Check

- **Gate command**: `pnpm typecheck && pnpm check && pnpm test && pnpm e2e`. It ran once on the real tree, and every part exited 0.
- **Result**:

  | Suite | Tests passed |
  | ----- | ------------ |
  | model | 22 |
  | input | 27 |
  | extract-python | 137 |
  | explain | 129 |
  | server | 49 |
  | web | 111 |
  | **Unit total** | **475, with 0 failed and 0 skipped** |
  | E2E: `fatia-central` | 14 |
  | E2E: `fidelidade` | 4 |
  | E2E: `cache` | 4 |
  | E2E: `pasta-local` | 9 |
  | **E2E total** | **31 passed, with 0 skipped** (PROJ-08 ran) |

- **Test count**:
  - Iteration 1 ran 471 unit tests. This iteration ran 475: 3 new server tests and 1 new extract-python test.
  - No test was removed.
  - One test was renamed (`json-only.test.ts:49`), and it keeps its assertion. No assertion was weakened.
  - Both PROJ-07 tests now use a fresh tree, which is stricter.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / surgical changes | ✅ `ffe0a66..75f9230` changes only tests, one test setup file and the spec. No production code changed. |
| No scope creep | ✅ |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ Exact texts, the byte boundary, the 8 names, IDs and status codes |
| Per-layer Coverage Expectation | ⚠️ The extract-python import-wire path misses 2 resolution forms (N10, N12). The input extension filter misses near-miss names (N13). |
| Every test maps to a spec requirement | ✅ `setup.tsx` is not a test. It supports the CORE-01 and CORE-16 timing. |
| Documented guidelines followed | ✅ `CLAUDE.md`, plus the tasks.md matrix |

---

## Edge Cases

- [x] All 8 ignored folders are pinned.
- [x] The 1 MB boundary: 1 048 576 bytes are read, and 1 048 577 bytes are ignored.
- [x] All 4 reason texts are exact.
- [x] Each non-JSON POST gets 415: `text/plain`, form, multipart and no header.
- [x] The cache identity uses the real root, for `..`, a trailing separator and a junction.
- [x] An unimported dotted project call gets no step.
- [x] The PROJ-07 fingerprint is taken before the first read.
- [ ] A `.pyc` or `.pyi` file next to the `.py` files: implemented, not tested (N13).
- [ ] A script-style `import b` gets an import wire: implemented, not tested (N10).
- [ ] `from . import b` gets an import wire: implemented, not tested (N12).

---

## Fix Plans

### Fix 6: Pin the extension filter with near-miss names (PROJ-01). Minor.

- **Root cause**: `read-folder.test.ts` has only `notas.txt` as a non-`.py` file.
- **Fix task**: add `stub.pyi` (valid UTF-8) and `a.pyc` (bytes `0xff 0xfe`) to `makeTree` in `packages/input/src/__tests__/read-folder.test.ts`. Assert that neither one is in `files` or in `ignored`. The order test at `:106` then still expects the 4 `.py` files.
- **Done when**: N13 is killed.

### Fix 7: Wire tests for the two untested import forms (PROJ-03). Minor.

- **Root cause**: the `imports wires` tests in `project.test.ts:224-280` use only absolute imports and `from .itens import …`.
- **Fix task**: in `packages/extract-python/src/__tests__/project.test.ts`, add two tests:
  1. `scripts/a.py` = `import b` and `scripts/b.py` = `def g(): …` give exactly `["imports:file:scripts/a.py->file:scripts/b.py"]`.
  2. `pedidos/__init__.py`, `pedidos/a.py` = `from . import b` and `pedidos/b.py` give exactly `["imports:file:pedidos/a.py->file:pedidos/b.py"]`.
- **Done when**: N10 and N12 are killed.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| PROJ-01 | ❌ Needs Fix (iteration 1) | ❌ Needs Fix (tests only: Fix 6) |
| PROJ-03 | ✅ Behaviour verified | ❌ Needs Fix (tests only: Fix 7) |
| PROJ-02, 04..09 | ✅ Behaviour verified | ✅ Verified at the test level. The spec status is unchanged until the feature passes. |

---

## Iteration History

- **Iteration 1** (`ffe0a66`, at `baa8cdd`): FAIL.
  - 9/9 ACs matched the spec outcome, with 4 spec-precision gaps. The gate gave 471 unit and 31 E2E tests.
  - The sensor killed 32 of 38 mutants. The survivors were M1a, M1b and M1d (3 of the 8 ignored folders were unpinned), M11 (the 415 tests sent only `text/plain`), M13 (the cache identity used the typed root) and M7b (the unimported dotted call).
  - It also flagged Q-1: the PROJ-07 snapshots were taken after earlier reads.
- **Between iterations**: `076cf10` settled SP-1..4 in the spec. `159178b`, `755550f`, `d4c105a`, `679e890` and `f18259c` added the test fixes 1–5. `75f9230` added a jsdom warm-up for the load-sensitive first tests.
- **Iteration 2** (this report, at `75f9230`): all 7 earlier survivors are killed, and Q-1 is fixed. 3 new survivors were found: N10, N12 and N13.

---

## Summary

**Overall**: ❌ Not Ready. All the behaviour is correct, and 2 test-only fix tasks remain (Fixes 6 and 7).

**Spec-anchored check**: 9/9 ACs matched the spec outcome, with 0 spec-precision gaps. AD-013..016 are covered, and the regression holds for features 01 and 04.
**Sensor**: 18 of 21 mutants killed. The survivors are N10, N12 and N13.
**Gate**: 475 unit and 31 E2E tests passed, with 0 failed and 0 skipped.

**Next steps**: route Fixes 6 and 7 to an implementer, then re-verify. That is iteration 3 of 3. If anything survives it, escalate to the user.
