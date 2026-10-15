# 02-pasta-local Validation

**Date**: 2026-10-13
**Spec**: `.specs/features/02-pasta-local/spec.md` (PROJ-01..09 and the Independent Test, as settled in `076cf10`)
**Diff range**: the feature is `775a28a..a7ccd61` without the feature-04 commits (`51d4b12`, `890dfe3`, `1a68e4e`, `b9483a1`, `81cc767`, `60c6243`, `2a60114`, `7895637`). This iteration re-checks the fixes in `c399efb..a7ccd61`: `bffb18d`, `fe3ef9f` and `a7ccd61` (tests only).
**Iteration**: 3 of 3
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 02-pasta-local - PASS ✅

- All 9 ACs have `file:line` evidence, and each assertion targets the exact spec outcome.
- The full gate is green: 477 unit tests and 31 E2E tests.
- The sensor ran 32 mutants and killed all of them:
  - the 3 survivors of iteration 2 (N10, N12, N13);
  - the 18 mutants that iteration 2 killed (no regression);
  - 11 new mutants in areas that iteration 2 did not touch.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T32 | ✅ Done (32/32 `✅ Complete`) | The checkmarks were not trusted. Every AC below is re-derived from the code and the tests at `a7ccd61`. |
| Iteration-1 fixes 1–5 | ✅ Landed | Their mutants were re-run below and are killed. |
| Iteration-2 fixes 6–7 | ✅ Landed | `a7ccd61` (Fix 6), `bffb18d` and `fe3ef9f` (Fix 7). The diff `c399efb..a7ccd61` changes only `project.test.ts` (+23 lines) and `read-folder.test.ts` (+6/−2). No production code changed. |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| PROJ-01 | Every `.py` file in the folder and its subfolders is read, except under the 8 named folders `.git`, `.venv`, `venv`, `node_modules`, `__pycache__`, `site-packages`, `build`, `dist` | `packages/input/src/__tests__/read-folder.test.ts:90-101`: a loop over all 8 names, with `all.some((p) => p.includes(bad))` `toBe(false)`. `:108`: `files` `toEqual(["B.py","_x.py","a.py","pedidos/itens.py"])`. `:119-121`: `notas.txt`, `stub.pyi` and `a.pyc` are in neither `files` nor `ignored` (both `toBe(false)`). `packages/server/src/__tests__/main.test.ts:288`: `files` `toHaveLength(8)`. `e2e/pasta-local.e2e.ts:249`: no `x.py` or `y.py` text | ✅ PASS (N13 is killed) |
| PROJ-02 | One node per folder at the top level, one node per file inside each folder, and root files under "raiz" | `packages/extract-python/src/__tests__/project.test.ts:14`: the exact `[id, kind, label, path, parentId]` of the 12 folder and file nodes. `e2e/pasta-local.e2e.ts:100`: the top level `toEqual(["dir:.","dir:frete","dir:legado","dir:pedidos"])`. `:106`: the labels. `:116`: the 3 files of `pedidos`. `:130`: `raiz` holds `main.py` and `relatorio.py` | ✅ PASS |
| PROJ-03 | A file that imports another file of the root gets an import wire to it | `project.test.ts:225-242`: `importIds` `toEqual` the 4 exact edges. `:244`, `:254`, `:263`, `:271`: a submodule, `__init__`, outside the root, the file itself, and a duplicate. `:281-291`: `from . import b` `toEqual(["imports:file:pedidos/a.py->file:pedidos/b.py"])`. `:293-302`: script-style `import b` `toEqual(["imports:file:scripts/a.py->file:scripts/b.py"])`. `e2e/pasta-local.e2e.ts:139-155`: 2 `edge-imports` wires at the top, and `pedidos.py→itens.py` inside `pedidos` | ✅ PASS (N10 and N12 are killed) |
| PROJ-04 | A call through a resolved import to another file's function gets a call wire between the two functions | `project.test.ts:113-130`: a `call` step labelled `calcular_frete` targets `file:frete/calculo.py/fn:calcular_frete` through the `frete/__init__.py` re-export, and the `calls` edge exists. `:132`: `main → processar_pedido`. `apps/ui/src/__tests__/App.test.tsx:336`. `e2e/pasta-local.e2e.ts:176-186`: the step jumps, and the breadcrumb reads `loja › frete › calculo.py › calcular_frete` | ✅ PASS |
| PROJ-05 | A path that does not exist, or is not a folder, shows `Pasta não encontrada: <caminho>` | `read-folder.test.ts:125-132`: `{kind:"not-found"}` for a missing path and for a file. `packages/server/src/__tests__/project-route.test.ts:52-59`: `404 {error:"not-found", path}`, with the path as typed. `App.test.tsx:237-245`: the alert is `toBe("Pasta não encontrada: C:\\nao\\existe")`. `e2e/pasta-local.e2e.ts:231`: `toHaveText(\`Pasta não encontrada: ${path}\`)` for both cases | ✅ PASS |
| PROJ-06 | Ignored files show as `<caminho> — <motivo>`, with exactly 4 reason texts. The boundary is 1 048 576 bytes: a file of that size is read, and a file 1 byte larger is ignored | `packages/input/src/__tests__/read-file.test.ts:27-35`: 1 048 576 bytes give `ok`. `:37-44`: 1 048 577 bytes give `too-large`. `:46-53`: `not-utf8`. `:69-77`: `EACCES` gives `unreadable`. `:81-111`: `symlink`. `apps/ui/src/panel/__tests__/IgnoredFiles.test.tsx:31`: all 4 exact texts. `main.test.ts:289`. `e2e/pasta-local.e2e.ts:245-246`: `"grande.py — maior que 1 MB"` and `"latin1.py — não está em UTF-8"` | ✅ PASS |
| PROJ-07 | The system only reads. It never writes, moves or executes files of the folder | `packages/input/src/__tests__/read-only.test.ts:53-65`: the write-API scan, and only `fs-read.ts` imports `node:fs`. `read-folder.test.ts:157-163`: a fresh tree, snapshotted before its first read (path, size, `mtimeMs`, sha256), stays `toEqual(before)`. `main.test.ts:328-333`. `e2e/pasta-local.e2e.ts:255-292`: on a fresh copy, `fingerprint(loja)` stays `toEqual(before)` | ✅ PASS |
| PROJ-08 | Listen only on IPv4 `127.0.0.1`. `localhost` works when it resolves to that address. `::1` and external interfaces are not listened on | `main.test.ts:400-403`: `listenOptions(4317)` `toEqual({port:4317, hostname:"127.0.0.1"})`, which `serve` uses at `packages/server/src/main.ts:109`. `e2e/pasta-local.e2e.ts:310`: `outcome` `toBe("ECONNREFUSED")` on the external IPv4. This test ran in the gate (`ok 30`). The Host guard allows `127.0.0.1:<port>` and `localhost:<port>` (`packages/server/src/app.ts:36`), and `project-route.test.ts:72` gives 403 for a foreign Host | ✅ PASS |
| PROJ-09 | A same-name call resolves through the caller's import. With no import, it is EXTERNO. A dotted call to a project module the file did not import gets no call wire | `project.test.ts:145-152`: `relatorio.py/fn:gerar` has exactly `[["external","calcular_frete","EXTERNO"]]`. `:155-163`: no edge targets `legado/frete_antigo.py`. `packages/extract-python/src/__tests__/project-calls.test.ts:73-79`: EXTERNO. `:81-87`: `frete.calcular_frete()` with no `import frete` gives `toBeNull()`, even with a resolver that would match. `e2e/pasta-local.e2e.ts:209`, `:223` | ✅ PASS |
| Independent Test | `pedidos/` and `frete/` give two folder nodes and an import wire between them. Opening `pedidos`, the call wire reaches `calcular_frete` | `e2e/pasta-local.e2e.ts:133-156` and `:158-191` | ✅ PASS |

**Status**: all 9 ACs matched the spec outcome, with 0 spec-precision gaps.

### Cross-cutting decisions (STATE.md)

| Decision | Evidence | Result |
| -------- | -------- | ------ |
| AD-013 (IDs `dir:` and `file:`, POSIX paths, code-unit order) | `project.test.ts:14`: the exact IDs. `:167`: the same graph on two runs and with the files reversed. `read-folder.test.ts:108`: code-unit order. The new mutant X3 (no sort of the directory entries) is killed by `:108` | ✅ |
| AD-014 (`input` is read-only and depends only on `model`) | `read-only.test.ts:53-65`. The dependency-cruiser rule `input-only-model` passes in `pnpm check` ("no dependency violations found") | ✅ |
| AD-015 (`{root,nodeId}`, re-read from disk, identity `<real POSIX root>\|<id>`, neighbour `<path>:<label>`) | `project-route.test.ts:145`: `nodeId` `C:/tmp/loja\|…`, and the neighbours are qualified. The new mutant X1 (neighbours always unqualified) is killed by this test. `main.test.ts:346`: a line added on disk reaches the explain call. `main.test.ts:349-395`: one cache entry for the folder typed three ways. `project-route.test.ts:168`: the client's `source` and `code` are ignored | ✅ |
| AD-016 (415 for any non-JSON POST) | `packages/server/src/__tests__/json-only.test.ts:40`: `text/plain`. `:57-69`: no `content-type` header. `:72-94`: form and multipart on all 3 routes, each `toBe(415)` | ✅ |

### Regression (features 01 and 04)

- `e2e/fatia-central.e2e.ts` passes 14/14, `e2e/fidelidade.e2e.ts` passes 4/4, and `e2e/cache.e2e.ts` passes 4/4.
- The explain suite passes 129/129, and the model suite passes 22/22.
- No file outside the two test files changed in `c399efb..a7ccd61`.

---

## Discrimination Sensor

**Setup.** The sensor ran in a scratch `git worktree` at `HEAD a7ccd61`, under the session scratchpad. The files were checked out with LF line endings. Dependencies were installed with `pnpm install --offline --frozen-lockfile`. The baseline in the scratch was 27 input, 139 extract-python, 49 server and 111 web tests, all passing.

**Method.**

- Each mutant is an exact text substitution. The script requires exactly one match.
- Each mutant ran against `vitest run` of every listed package.
- After each mutant, the file was reverted with `git checkout`, and `git status --porcelain` of the scratch was checked to be empty.

**Cleanup.** The worktree was removed and pruned. The real tree's `git status --porcelain` was ` M .specs/STATE.md` before the sensor and after it. They match.

### Iteration-2 survivors (re-run)

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| N10 | `packages/extract-python/src/project.ts:162` | Import wires stop falling back to the caller's folder (`[absolute]` only, PROJ-03) | ✅ Killed by `project.test.ts:293` (script-style `import b`) |
| N12 | `project.ts:146` | `from . import b` is joined as `..b` (the joiner is always `.`) (PROJ-03) | ✅ Killed by `project.test.ts:281` (`from . import b`) |
| N13 | `packages/input/src/read-folder.ts:56` | `endsWith(extension)` → `includes(extension)` (PROJ-01) | ✅ Killed by `read-folder.test.ts:116` (`.pyi` and `.pyc`), `:108` and `:134` |

### Mutants killed in iteration 2 (regression re-run)

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| M1a | `read-folder.ts:7` | Drop `.git` from `IGNORED_DIRS` | ✅ `read-folder.test.ts:82`, `:105` |
| M1b | `read-folder.ts:12` | Drop `site-packages` | ✅ `read-folder.test.ts:82`, `:105` |
| M1d | `read-folder.ts:9` | Drop `venv` | ✅ `read-folder.test.ts:82`, `:105` |
| M11 | `packages/server/src/app.ts:52` | 415 only for `text/plain` (a denylist) | ✅ `json-only.test.ts` (no header; form and multipart) |
| M13 | `app.ts:111` | Cache identity from the typed `root`, not the real path | ✅ `main.test.ts` (the folder typed three ways) |
| M7b | `packages/extract-python/src/calls.ts:61` | Ask the project resolver even when the head was never imported | ✅ `project-calls.test.ts:81` |
| M4b | `packages/input/src/read-file.ts:24` and `fs-read.ts:2` | `utimes(abs, 0, 0)` after each read | ✅ `read-folder.test.ts:157` (PROJ-07) |
| N1 | `read-folder.ts:41` | Drop the `isDirectory()` check (PROJ-05) | ✅ `read-folder.test.ts:125` |
| N2 | `read-file.ts:23` | `size > MAX` → `size > MAX + 1` (PROJ-06) | ✅ `read-file.test.ts:37`, `read-folder.test.ts:105`, `:134` |
| N3 | `packages/extract-python/src/modules.ts:90-92` | Stop following a re-export in `__init__.py` (PROJ-04) | ✅ `modules.test.ts`, `project.test.ts:113` |
| N4 | `modules.ts:9` | `a/b/__init__.py` named `a.b.__init__` | ✅ 7 tests, including `project.test.ts:225` and `extractor.test.ts` |
| N5 | `calls.ts:63` | A project call step loses its label as written (PROJ-04) | ✅ `project-calls.test.ts`, `build-graph-prefix.test.ts`, `project.test.ts:113` |
| N6 | `app.ts:102` | Explain takes the code of `files[0]`, not the node's file (AD-015) | ✅ `main.test.ts` (a line added on disk) |
| N7 | `packages/server/src/main.ts:71` | `composeReadProject` returns `ignored: []` (PROJ-06) | ✅ `main.test.ts:289` |
| N8 | `apps/ui/src/panel/IgnoredFiles.tsx:7` | `symlink` text → "link simbólico" (PROJ-06) | ✅ `IgnoredFiles.test.tsx:31` |
| N9 | `apps/ui/src/nav/Breadcrumb.tsx:16` | The breadcrumb always starts with "Trecho" | ✅ 5 tests in `Breadcrumb.test.tsx` and `App.test.tsx` |
| N11 | `apps/ui/src/flow/project-level.ts:68` | A lifted wire onto one node is kept (a self-loop on a folder) | ✅ 3 tests in `project-level.test.ts` |
| N14 | `apps/ui/src/App.tsx:158` | The empty-folder text → "Nenhum arquivo encontrado." | ✅ `App.test.tsx` (empty-folder message) |

### New mutants (iteration 3)

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| X1 | `app.ts:108` | A neighbour from another file is never named `<path>:<label>` (AD-015, PROJ-09) | ✅ `project-route.test.ts` ("builds the request … with qualified neighbours") |
| X2 | `project.ts:179` | An import of the file itself gets a wire (PROJ-03) | ✅ `project.test.ts:263` |
| X3 | `read-folder.ts:51` | The directory entries are not sorted by code unit (AD-013) | ✅ `read-folder.test.ts:105` |
| X4 | `modules.ts:26` | `up >= segments.length` → `>`: a relative import above the root resolves to the root | ✅ `modules.test.ts` (`relativeBase` "is null above the root") |
| X5 | `apps/ui/src/nav/navigation.ts:23` | `ancestry` stops at the node itself (PROJ-04 jump) | ✅ `navigation.test.ts`, `App.test.tsx` (the jump), `Breadcrumb.test.tsx` |
| X6 | `project.ts:121` | The "raiz" folder and the root files are never laid out (PROJ-02) | ✅ 6 extract-python tests, including `project.test.ts:14` and `:145`, and 1 server test |
| X7 | `main.ts:80` | `hostname: "0.0.0.0"` (PROJ-08) | ✅ `main.test.ts:400` |
| X8 | `read-file.ts:22` | A symbolic link is followed, not ignored (PROJ-06) | ✅ `read-file.test.ts:81` |
| X9 | `app.ts:124` | Explain accepts any node kind, not only a function or class | ✅ `project-route.test.ts` (folder and file nodes give 400), `explain-route.test.ts` |
| X10 | `modules.ts:86` | `mod.Classe.metodo` (2 segments left) resolves to the class | ✅ `modules.test.ts` ("leaves a method of a class unresolved") |
| X11 | `project.ts:72` | A file node has `parentId: null`, not its folder (PROJ-02) | ✅ `project.test.ts:14` |

**Sensor depth**: P0-style. The feature reads arbitrary local paths, and the sensor covered input, extract-python, server and web.
**Result**: 32 mutants, 32 killed and 0 survived. **PASS ✅**

---

## Gate Check

- **Gate command**: `pnpm typecheck && pnpm check && pnpm test && pnpm e2e`. It ran once on the real tree at `a7ccd61` and exited 0.
- **Result**:

  | Suite | Tests passed |
  | ----- | ------------ |
  | model | 22 |
  | input | 27 |
  | extract-python | 139 |
  | explain | 129 |
  | server | 49 |
  | web | 111 |
  | **Unit total** | **477, with 0 failed and 0 skipped** |
  | E2E: `fatia-central` | 14 |
  | E2E: `fidelidade` | 4 |
  | E2E: `cache` | 4 |
  | E2E: `pasta-local` | 9 |
  | **E2E total** | **31 passed, with 0 skipped** (PROJ-08 ran) |

- **Test count**:
  - Iteration 2 ran 475 unit tests. Iteration 3 runs 477: 2 new extract-python tests (`project.test.ts:281` and `:293`).
  - The input count is unchanged (27). `a7ccd61` widens one test from 1 name to 3 names.
  - No test was removed, and no assertion was weakened.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code / surgical changes | ✅ `c399efb..a7ccd61` changes only 2 test files. |
| No scope creep | ✅ |
| Matches patterns | ✅ The new tests use the existing `projectOf` and `importIds` helpers and the existing `makeTree`. |
| Spec-anchored outcome check | ✅ Exact texts, the byte boundary, the 8 names, the IDs and the status codes |
| Per-layer Coverage Expectation | ✅ Every import-wire resolution form has a wire test. The extension filter is pinned with near-miss names. |
| Every test maps to a spec requirement | ✅ The 2 new tests map to PROJ-03, and the widened test maps to PROJ-01. |
| Documented guidelines followed | ✅ `CLAUDE.md` and the tasks.md matrix |

---

## Edge Cases

- [x] All 8 ignored folders are pinned.
- [x] The 1 MB boundary: 1 048 576 bytes are read, and 1 048 577 bytes are ignored.
- [x] All 4 reason texts are exact.
- [x] Each non-JSON POST gets 415: `text/plain`, form, multipart and no header.
- [x] The cache identity uses the real root, for `..`, a trailing separator and a junction.
- [x] A dotted call to a project module the file did not import gets no step.
- [x] The PROJ-07 fingerprint is taken before the first read.
- [x] A `.pyc` or `.pyi` file next to the `.py` files stays out of `files` and `ignored`.
- [x] A script-style `import b` gets an import wire.
- [x] `from . import b` gets an import wire.
- [x] A relative import above the root stays unresolved (X4), and so does `mod.Classe.metodo` (X10).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| PROJ-01..09 | Pending (PROJ-01 and PROJ-03 needed test fixes) | ✅ Execute, Verified |

---

## Iteration History

- **Iteration 1** (`ffe0a66`, at `baa8cdd`): FAIL.
  - All 9 ACs matched the spec outcome, with 4 spec-precision gaps. The gate gave 471 unit and 31 E2E tests.
  - The sensor killed 32 of 38 mutants.
  - The 6 survivors were M1a, M1b and M1d (3 of the 8 ignored folders had no test), M11, M13 and M7b. Q-1 was also flagged (the PROJ-07 snapshots were taken after earlier reads).
- **Iteration 2** (`c399efb`, at `75f9230`): FAIL.
  - `076cf10` settled SP-1..4. Fixes 1–5 killed every iteration-1 survivor and fixed Q-1.
  - The gate gave 475 unit and 31 E2E tests. The sensor killed 18 of 21 mutants.
  - The survivors were N10, N12 and N13. Fixes 6 and 7 were routed (tests only).
- **Iteration 3** (this report, at `a7ccd61`): PASS. Fixes 6 and 7 killed N10, N12 and N13. All 18 earlier kills hold, and 11 new mutants are killed.

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: all 9 ACs matched the spec outcome, with 0 spec-precision gaps. AD-013..016 are covered. The regression holds for features 01 and 04.
**Sensor**: 32 of 32 mutants killed.
**Gate**: 477 unit and 31 E2E tests passed, with 0 failed and 0 skipped.

**What works**: the folder reading, the folder and file map, import and call wires, the not-found and ignored-file messages, read-only access, the loopback-only server, and same-name resolution.

**Issues found**: none.

**Next steps**: none for this feature. The spec traceability is set to Verified.
