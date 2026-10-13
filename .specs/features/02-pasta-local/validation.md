# 02-pasta-local Validation

**Date**: 2026-10-13
**Spec**: `.specs/features/02-pasta-local/spec.md` (PROJ-01..09 and the Independent Test)
**Diff range**: `1fd6dcd..ac6521a` (branch `feat/02-pasta-local`, T1–T20), merged at `be744a4`, then `396a454..baa8cdd` on master (T21–T32). This is `775a28a..HEAD` without the feature-04 commits (`51d4b12`, `890dfe3`, `1a68e4e`, `b9483a1`, `81cc767`, `60c6243`, `2a60114`, `7895637`).
**Regression**: features 01 (CORE-01..24) and 04 (FID-01..15, CACHE-01..07).
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 02-pasta-local - FAIL ❌

All 9 ACs and the Independent Test are implemented. Each one has `file:line` evidence that targets the spec outcome, and the full gate is green: 471 unit tests and 31 E2E tests. The verdict is FAIL because the discrimination sensor left 6 behaviour-changing mutants alive, out of 38. Three of them are on a spec-named behaviour: 3 of the 8 ignored folders are not pinned (PROJ-01). Another weakens a security guard (AD-016): the 415 tests only ever send `text/plain`. The fixes add tests only. No production code is wrong.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1–T32 | ✅ Done (32/32 `✅ Complete`, no open checkbox) | The checkmarks were not trusted. Every AC below is re-derived from the code and the tests. |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| PROJ-01 | Read every `.py` in the folder and its subfolders, except `.git`, `.venv`, `venv`, `node_modules`, `__pycache__`, `site-packages`, `build`, `dist` | `packages/input/src/__tests__/read-folder.test.ts:83` - `all.some((p) => p.includes(bad))` `toBe(false)` for `.venv`, `node_modules`, `dist`, `__pycache__`, `build` at depth 0 and 1; `:85` - `pedidos/itens.py` is included; `packages/server/src/__tests__/main.test.ts:287` - `files` `toHaveLength(8)`; `e2e/pasta-local.e2e.ts:80` - no node id matches `.venv\|dist` | ⚠️ PASS with a test gap. `.git`, `venv` and `site-packages` are in `IGNORED_DIRS` (`packages/input/src/read-folder.ts:6-15`), but no test pins them (M1a, M1b, M1d survived). |
| PROJ-02 | One node per folder at the top level, and one node per file inside each folder (root files under "raiz") | `packages/extract-python/src/__tests__/project.test.ts:17-70` - exact `[id, kind, label, path, parentId]` for 12 folder and file nodes, `["dir:.", "folder", "raiz", "", null]` first; `apps/web/src/flow/__tests__/project-level.test.ts:158`; `e2e/pasta-local.e2e.ts:94-125` - top level `toEqual(["dir:.","dir:frete","dir:legado","dir:pedidos"])`, labels `raiz/frete/legado/pedidos`, `pedidos` holds its 3 files, `raiz` holds `main.py` and `relatorio.py` | ✅ PASS |
| PROJ-03 | An import between two files of the root draws an import wire between them | `project.test.ts:228-235` - `importIds` `toEqual` the 4 exact edges; `:244-279` - submodule, `__init__`, outside the root, self and duplicate; `e2e/pasta-local.e2e.ts:134-150` - 2 edges, `dir:pedidos→dir:frete` and `dir:.→dir:pedidos` with class `edge-imports`, and 1 wire `pedidos.py→itens.py` inside `pedidos` | ✅ PASS |
| PROJ-04 | A call to a function in another file, through a resolved import, draws a call wire between the two functions | `project.test.ts:118-129` - the `call` step labelled `calcular_frete` targets `file:frete/calculo.py/fn:calcular_frete`, and the `calls` edge exists (through the `frete/__init__.py` re-export); `:135` - `main → processar_pedido`; `apps/web/src/__tests__/App.test.tsx:336`; `e2e/pasta-local.e2e.ts:170-185` - step `calcular_frete` jumps, and the breadcrumb is `loja › frete › calculo.py › calcular_frete` | ✅ PASS |
| PROJ-05 | A path that does not exist, or is not a folder, shows `Pasta não encontrada: <caminho>` | `read-folder.test.ts:107-112` - `not-found` for a missing path and for a file; `packages/server/src/__tests__/project-route.test.ts:55-59` - `404 {error:"not-found", path:"./nao/existe"}` (the path as typed); `App.test.tsx:244` - alert text `toBe("Pasta não encontrada: C:\\nao\\existe")`; `e2e/pasta-local.e2e.ts:226-228` - `toHaveText(\`Pasta não encontrada: ${path}\`)` for both cases | ✅ PASS |
| PROJ-06 | A file that cannot be read, or is over 1 MB, is skipped and listed in "Arquivos ignorados" with its reason | `packages/input/src/__tests__/read-file.test.ts:27-46` - 1 048 576 bytes `ok`, 1 048 577 bytes `too-large`; `:47-54` `not-utf8`; `:69-79` `EACCES` gives `unreadable`; `read-folder.test.ts:118-121` - `ignored` `toEqual` both, sorted; `apps/web/src/panel/__tests__/IgnoredFiles.test.tsx:16`; `e2e/pasta-local.e2e.ts:240-243` - `["grande.py — maior que 1 MB", "latin1.py — não está em UTF-8"]` | ✅ PASS (see SP-1, SP-2) |
| PROJ-07 | Only read files. Never write, move or execute files of the analysed folder. | `packages/input/src/__tests__/read-only.test.ts:53-63` - `forbiddenUses` is `[]` for every module, and only `fs-read.ts` imports `node:fs`; `read-folder.test.ts:138-142` - snapshot of path, size, `mtimeMs` and sha256; `main.test.ts:332` - `snapshot(loja)` `toEqual(before)` across map and explain; `e2e/pasta-local.e2e.ts:283` - `fingerprint(LOJA)` `toEqual(before)` | ✅ PASS (see Q-1 on test order) |
| PROJ-08 | Accept connections only on `127.0.0.1` | `main.test.ts:350-353` - `listenOptions(4317)` `toEqual({port:4317, hostname:"127.0.0.1"})`; `packages/server/src/main.ts:109` uses it in `serve`; `e2e/pasta-local.e2e.ts:301` - a TCP connect to the external IPv4 on 4317 gives `ECONNREFUSED`. It ran in this gate, with `ok` and not skipped. | ✅ PASS (see the PROJ-08 note) |
| PROJ-09 | When two files define the same name, the call resolves through the caller's import. Without an import, it is EXTERNO. | `project.test.ts:148-152` - `relatorio.py/fn:gerar` has exactly `[["external","calcular_frete","EXTERNO"]]`; `:158-162` - no edge targets `legado/frete_antigo.py/fn:calcular_frete`; `:118-129` - the importing caller resolves to the `frete` copy; `project-calls.test.ts:73-82`; `e2e/pasta-local.e2e.ts:203-218` | ✅ PASS (see the M7b note) |
| Independent Test | `pedidos/` and `frete/` give two folder nodes and an import wire. Opening `pedidos`, the call wire reaches `calcular_frete`. | `e2e/pasta-local.e2e.ts:128-151` and `:153-186` | ✅ PASS |

**Status**: 9/9 ACs have evidence that matches the spec outcome. There are 4 spec-precision gaps, and 5 sensor survivors (one on PROJ-01).

### Regression (features 01 and 04)

- **CORE-01..24**: the 14 E2E tests in `e2e/fatia-central.e2e.ts` pass. All feature-01 unit suites pass unchanged in intent.
  - **CORE-04** (same IDs): `packages/extract-python/src/__tests__/extractor.test.ts:18` matches the snapshot. `build-graph-prefix.test.ts` shows that the snippet path, with no `prefix`, keeps the bare IDs (`fn:x`, `mod`). `e2e/fatia-central.e2e.ts:181` is green.
  - **Project determinism**: `project.test.ts:167-172` gives the same graph on two runs and with the files reversed. M16 proves that the paths are normalized to POSIX.
- **FID / CACHE (22)**:
  - `e2e/fidelidade.e2e.ts` passes 4/4 and `e2e/cache.e2e.ts` passes 4/4. The explain suite passes 129/129.
  - **CACHE-02/03/06**: the identity is `sha256(nodeId)` (`packages/explain/src/cache.ts:64-65`). A project node's `nodeId` is `<real POSIX root>|<id>` (`packages/server/src/app.ts:111`, asserted in `project-route.test.ts:145` as `C:/tmp/loja|file:…`).
    - Snippet IDs never start with `file:`, so a snippet and a project cannot collide.
    - Different roots get different entries.
    - `realpath` canonicalizes case, separators and a trailing slash on Windows. Checked by hand: `c:\users\…\STUDY\code2n8n\` gives `C:\Users\…\study\code2n8n`.
    - No test pins that the *real* root is used rather than the typed one (M13).
  - **FID-06** (cross-file neighbours): `project-route.test.ts:152` - `calledBy` `toEqual(["pedidos/pedidos.py:processar_pedido"])`; `:164` - a same-file neighbour gets its bare label. The reviewer receives these names through `calls` and `calledBy`.

---

## Spec-Precision Gaps

| # | AC | Gap | What was implemented |
| - | -- | --- | -------------------- |
| SP-1 | PROJ-06 | "1 MB" is not defined as 1 000 000 or 1 048 576 bytes. | 1 048 576 (`read-file.ts:4`), pinned on both sides of the boundary by the design and the tests. |
| SP-2 | PROJ-06 | The spec gives no reason texts. "Não pode ser lido" does not say whether invalid UTF-8 or a link counts as unreadable. | 4 reasons with their texts, from the design (`IgnoredFiles.tsx:3-8`). `not-utf8` and `symlink` go beyond the spec's two cases. |
| SP-3 | PROJ-09 | It covers only a bare name. It says nothing about a dotted call to a project module that was never imported (`frete.calcular_frete()` with no `import frete`). | Today no step is produced (`calls.ts:66-72`). The behaviour is not pinned (M7b). |
| SP-4 | PROJ-08 | "Only 127.0.0.1" leaves out `localhost` in the Host guard, and IPv6 `::1`. | Listens on `127.0.0.1`. The Host guard also accepts `localhost:<port>` (`app.ts:36`). This is consistent with the spec. |

---

## Discrimination Sensor

Run in a scratch `git worktree` under the scratchpad, at `HEAD baa8cdd`. Each mutant was run against its package's `vitest run`, and was reverted with `git checkout` after each run. The worktree was removed afterwards. The real tree's `git status --porcelain` was empty before and after.

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| M1a | `packages/input/src/read-folder.ts:7` | Drop `.git` from `IGNORED_DIRS` | ❌ Survived |
| M1b | `read-folder.ts:12` | Drop `site-packages` | ❌ Survived |
| M1c | `read-folder.ts:11` | Drop `__pycache__` | ✅ Killed |
| M1d | `read-folder.ts:9` | Drop `venv` | ❌ Survived |
| M2 | `packages/input/src/read-file.ts:23` | `size > MAX` → `>=` (1 MB boundary) | ✅ Killed |
| M3a | `read-folder.ts:60` | Also walk symlinked dirs in the dir branch | ➖ Equivalent: the link branch at `:55` catches links first |
| M3b | `read-file.ts:22` | Remove the `isSymbolicLink` check | ✅ Killed |
| M3c | `read-folder.ts:55,60` | Follow links: the file branch only takes `isFile()`, and the dir branch takes links | ✅ Killed (junction test) |
| M4a | `packages/input/src/fs-read.ts:2` | Export `writeFile` | ✅ Killed (scan) |
| M4b | `read-file.ts:24` | `utimes(abs, 0, 0)` after reading (idempotent write) | ✅ Killed by `server/main.test.ts:332`. It survives the input suite alone (see Q-1). |
| M4c | `read-file.ts:24` | `utimes(abs, now, now)` after reading | ✅ Killed |
| M5 | `packages/extract-python/src/modules.ts:25` | Relative level off by one | ✅ Killed |
| M6 | `modules.ts:107` | Caller folder before the root | ✅ Killed |
| M6b | `modules.ts:107` | No fallback to the caller folder | ✅ Killed |
| M7 | `packages/extract-python/src/calls.ts:68` | An unimported project name is no longer EXTERNO (PROJ-09) | ✅ Killed |
| M7b | `calls.ts:61` | Resolve through the project even when the head was never imported | ❌ Survived |
| M8 | `packages/extract-python/src/project.ts:179` | Allow a self-import wire | ✅ Killed |
| M8b | `project.ts:165` | Deepest module starts one segment short | ✅ Killed |
| M8c | `project.ts:220` | Drop all import edges | ✅ Killed |
| M9 | `packages/extract-python/src/build-graph.ts:229` | Drop the file prefix from IDs | ✅ Killed |
| M10 | `packages/server/src/app.ts:69` | Project not-found returns 400 instead of 404 | ✅ Killed |
| M11 | `app.ts:52` | 415 only for `text/plain` (denylist instead of the JSON allowlist) | ❌ Survived |
| M11b | `app.ts:46` | 415 middleware only on `/api/graph` | ✅ Killed |
| M12 | `app.ts:89` | Memoize `readProject` per root (explain stops re-reading the folder) | ✅ Killed |
| M12b | `app.ts:87` | Prefer the client `source` when it comes with `root` | ✅ Killed |
| M13 | `app.ts:111` | Cache identity from the typed `root` instead of the real path | ❌ Survived |
| M13b | `app.ts:111` | Do not normalize `\` to `/` in the identity | ✅ Killed |
| M14 | `packages/server/src/main.ts:80` | `listenOptions` returns `0.0.0.0` | ✅ Killed |
| M14e | `main.ts:109` | `serve` bypasses `listenOptions` (binds `::`) | ✅ Killed. The PROJ-08 E2E probe, re-run by hand, gives `connected` on the mutant and `ECONNREFUSED` on the original. |
| M15 | `read-file.ts:26` | `fatal: false` in `TextDecoder` | ✅ Killed |
| M16 | `read-file.ts:15` | Keep `\` in `rel` (Windows separators in IDs) | ✅ Killed |
| M17 | `project.ts:48` | Root folder label `raiz` → `root` | ✅ Killed |
| M18 | `modules.ts:86` | Resolve `mod.Classe.metodo` | ✅ Killed |
| M19 | `app.ts:109` | Cross-file neighbour without its `<path>:` | ✅ Killed |
| M20 | `apps/web/src/App.tsx:153` | Alert without `: <caminho>` | ✅ Killed |
| M21 | `apps/web/src/panel/IgnoredFiles.tsx:4` | `too-large` reason text | ✅ Killed |
| M22 | `App.tsx:46` | Project explain origin is `{source}` instead of `{root}` | ✅ Killed |
| M23 | `App.tsx:59` | A cross-file call stacks instead of jumping | ✅ Killed |
| M24 | `apps/web/src/flow/project-level.ts:26` | The folder level lifts `calls` instead of `imports` | ✅ Killed |

**Sensor depth**: P0-style (≥5 per risk area). The feature reads arbitrary local paths, so it was treated as security-relevant.
**Result**: 38 behaviour-changing mutants, with M3a excluded as equivalent: 32 killed and 6 survived (M1a, M1b, M1d, M7b, M11, M13). **FAIL ❌**

### Why each survivor matters

- **M1a, M1b, M1d (PROJ-01)**: the spec names 8 folders. The test samples 5 of them.
- **M11 (AD-016)**:
  - `json-only.test.ts:49-56`, "refuses a post without content-type", does not do what its name says. `app.request(path, { body: string })` builds a `Request`, and fetch sets `content-type: text/plain;charset=UTF-8` for a string body. So both 415 tests send `text/plain`.
  - The two other CORS-simple types, `application/x-www-form-urlencoded` and `multipart/form-data`, are never sent.
  - The real code is correct. It is an allowlist, and a hand probe gives 415 for both types.
  - A regression to a denylist would pass every test and reopen the cross-site "simple POST" path that AD-016 exists to close.
- **M13 (AD-015 / CACHE-06)**: the route tests pass a `readProject` stub whose `root` equals the typed path. The same folder typed two ways would then give two cache identities, which breaks "one entry per node identity". No test catches that.
- **M7b (PROJ-09, SP-3)**: a dotted call whose head was never imported could be wired to a project function. This is low severity, because such code is a `NameError` in Python.

---

## Points Checked on Request

### Security (AD-015)

These are hand probes against the original server in the scratch worktree:

- **`{root,nodeId}` with an extra `source`**: answers `404 unknown node`. The client code is ignored, and `project-route.test.ts:168-181` pins this (M12b killed).
- **`nodeId` path traversal** (`file:../../…`): answers `404 unknown node`. The `nodeId` is only looked up among the IDs of the re-extracted graph. It is never used as a path. The cache file name is `sha256(nodeId)`.
- **Re-reading the folder**: explain re-reads and re-extracts the folder on every request (`main.test.ts:303-345`, M12 killed).
- **Snippet path**: `root: ""` together with `source` falls back to the snippet path. The client supplies that code by design (feature 01), and it has no access to the disk.
- **Foreign Host**: answers 403.
- **Non-JSON bodies**: `text/plain`, `x-www-form-urlencoded` and `multipart` all answer 415.
- **CORS**: no `Access-Control-*` header is sent.

**Residual risk (accepted by the spec, recorded here):**

- `/api/project` accepts **any** path. It is resolved with `realpath`, with no confinement to a base directory.
- The response returns the full `source` of every `.py` file under 1 MB beneath that path. Asking for `C:\` would walk the whole drive, with no limit on files or time. Input limits are deferred in the spec.
- This is consistent with PROJ-07 (read-only, `.py` only) and with the local single-user scope. Any local process, or another OS user on the same machine, can read every `.py` file the server's user can read.
- Browsers are blocked by the Host guard, the JSON-only rule (with preflight) and the absence of CORS.

**Recommendation:** keep the deferred input limits on the backlog. Consider a time or file cap before the tool is used on shared machines.

### Flaky test: DetailPanel CORE-16

`apps/web/src/panel/__tests__/DetailPanel.test.tsx:147`:

- **Not logically flaky**: there is no race in the assertions, and every await goes through `findByRole`.
- **Load-sensitive.** It is the first async test in the file, so it absorbs the cold cost of the first `render` and of the jsdom accessible-name computation behind `getByRole(…, { name })` (`listAfter` calls it twice).
- **Measured** in three isolated runs: 2467 ms, 800 ms and 414 ms. The cold first run is 6× slower than the warm one.
- **Why it can time out**: under `pnpm test`, every package runs concurrently and the web suite runs 13 jsdom workers, so the cold path can cross Vitest's 5 s default.
- **Suggested fix** (test-only): a per-file `testTimeout`, or swap the `getByRole(…{name})` lookups in `listAfter` for cheaper queries.

### PROJ-08 E2E

- **It ran**: `ok 30 … PROJ-08 … (2.1s)` in this gate, so it was not skipped. The external IPv4 was `192.168.15.11`.
- **It discriminates.** With only the original server running, the probe gives `ECONNREFUSED`. With only a mutant whose `serve` skips `listenOptions` (binding `::`), the same probe gives `connected` (M14e).
- **Caveat**: the test skips itself on a machine with no external IPv4, for example some CI containers. There, only `main.test.ts:350` covers PROJ-08.

### Determinism

- **IDs are stable across runs** (`project.test.ts:167-172`).
- **IDs are stable across file order**, because the files are sorted by code unit.
- **IDs are stable across separators.** `read-folder.ts` builds `rel` with `/`, and `read-file.ts:15` normalizes `\`. M16 is killed.
- **The identity root is POSIX** (`app.ts:111`, M13b killed).

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ Feature-01 and feature-04 tests changed only for the contract (`host-guard`, `graph-route` and `explain-route` gained a `readProject` stub) |
| No scope creep | ✅ |
| Matches patterns | ✅ The `input` boundary is enforced by dependency-cruiser (`input-only-model`) |
| Spec-anchored outcome check | ✅ Exact texts, IDs and status codes |
| Per-layer Coverage Expectation | ⚠️ `input` misses 3 ignored-folder entries, and the server 415 tests miss the form types |
| Every test maps to a spec requirement | ✅ |
| Documented guidelines followed | ✅ `CLAUDE.md`, plus the tasks.md matrix |

- **Q-1 (test order, PROJ-07).** `read-folder.test.ts:138` and `e2e/pasta-local.e2e.ts:250` take the "before" fingerprint after earlier tests in the same file have already read the folder. So an idempotent write survives them (M4b). Only `main.test.ts:303`, with a fresh copy, catches it. Not a survivor overall, but the two PROJ-07 tests are weaker than they look.

---

## Edge Cases

- [x] The 1 MB boundary: 1 048 576 bytes are read and 1 048 577 bytes are ignored.
- [x] A BOM is stripped.
- [x] `EACCES` gives `unreadable`.
- [x] A link is never read. A junction is not followed.
- [x] A relative import at levels 1 and 2 resolves. One above the root gives `null`.
- [x] A re-export through `__init__.py` resolves, and a re-export cycle stops.
- [x] The caller-folder fallback works, and the root wins.
- [x] `import *` creates no alias. `mod.Classe.metodo` stays unresolved.
- [x] A syntax error is marked per file. An empty folder gives `empty: true` and the message "Nenhum arquivo .py encontrado na pasta.".
- [x] A repeated node ID throws.
- [ ] Ignored folders `.git`, `venv` and `site-packages`: implemented but not tested (M1a, M1b, M1d).
- [ ] A 415 for form content types: implemented but not tested (M11).

---

## Gate Check

- **Gate command**: `pnpm typecheck && pnpm check && pnpm test && pnpm e2e`. Each part exits 0.
- **Result**:

  | Suite | Tests passed |
  | ----- | ------------ |
  | model | 22 |
  | input | 27 |
  | extract-python | 136 |
  | explain | 129 |
  | server | 46 |
  | web | 111 |
  | **Unit total** | **471, with 0 failed and 0 skipped** |
  | E2E: `fatia-central` | 14 |
  | E2E: `fidelidade` | 4 |
  | E2E: `cache` | 4 |
  | E2E: `pasta-local` | 9 |
  | **E2E total** | **31, with 0 skipped** |

- **Test count before the feature**: 330 test declarations at `7895637`, which is master with feature 04 and before the merge.
- **Test count after**: 468 declarations. 502 tests ran (471 unit + 31 E2E).
- **Delta**: +138 declarations. No count decreased, and no assertion was weakened.
- **Skipped**: none. PROJ-08 can skip conditionally, but it ran.

---

## Fix Plans

### Fix 1: Pin every ignored folder (PROJ-01). Minor.

- **Root cause**: `read-folder.test.ts:27-31` creates only 5 of the 8 folders.
- **Fix task**: in `packages/input/src/__tests__/read-folder.test.ts`, add `.git/x.py`, `venv/x.py` and `lib/site-packages/x.py`, and assert that the loop at `:76-84` covers all 8 names from the spec.
- **Done when**: M1a, M1b and M1d are killed.

### Fix 2: Test 415 for the other CORS-simple types and a really absent content-type (AD-016). Major, security.

- **Root cause**: `json-only.test.ts` sends string bodies, so fetch adds `text/plain`.
- **Fix task**: post `application/x-www-form-urlencoded` and `multipart/form-data` to all three routes and expect 415. Send the "no content-type" case with a body that gets no default type, such as a `Uint8Array`, or rename that test.
- **Done when**: M11 is killed.

### Fix 3: Pin the real root in the cache identity (AD-015, CACHE-06). Minor.

- **Root cause**: the route test's `readProject` returns `root` equal to the typed path.
- **Fix task**: in `project-route.test.ts`, have the stub return `root: "C:\\Real\\Loja"` for the typed `"c:/real/loja/"`, and assert `nodeId` `C:/Real/Loja|…`.
- **Done when**: M13 is killed.

### Fix 4: Pin PROJ-09 for an unimported dotted project path. Minor. Needs a spec decision first.

- **Fix task**: decide SP-3. Then, in `project-calls.test.ts`, assert that `frete.calcular_frete()` without `import frete` gives no `call` step to the project, even with a `resolveImport` that would hit.
- **Done when**: M7b is killed.

### Fix 5 (optional, quality): Take the PROJ-07 "before" fingerprint on a fresh copy.

Applies to `read-folder.test.ts:138` and `e2e/pasta-local.e2e.ts:247`, so that M4b dies in its own layer.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| PROJ-01 | Pending | ❌ Needs Fix (tests only: Fix 1) |
| PROJ-02..09 | Pending | ✅ Behaviour verified. PROJ-09 has a test gap pending SP-3 (Fix 4). |

---

## Summary

**Overall**: ❌ Not Ready. All the behaviour is correct, and 4 test-only fix tasks remain.

**Spec-anchored check**: 9/9 ACs matched the spec outcome. There are 4 spec-precision gaps (SP-1..4). Regression holds for CORE 24/24 and F04 22/22.
**Sensor**: 32/38 mutations killed. The survivors are M1a, M1b, M1d, M7b, M11 and M13.
**Gate**: 471 unit and 31 E2E tests passed, with 0 failed.

**What works**: folder reading, read-only and with links skipped; project IDs; import and call resolution, including the PROJ-09 same-name case; import wires; the `/api/project` route; explain re-reading the folder; loopback only; and the full web drill-down and jump.

**Issues found**: the test gaps in Fixes 1–4.

**Next steps**: route Fixes 1–4 to an implementer, then re-verify. This is iteration 1 of 3.
