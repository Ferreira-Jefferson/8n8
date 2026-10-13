# 01-fatia-central Validation

**Date**: 2026-10-13
**Spec**: `.specs/features/01-fatia-central/spec.md` (CORE-01..24)
**Diff range**: `6227009..d6f3b6a` (49 commits; `6227009` is the repository's first commit, so the whole tree is the feature surface)
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 01-fatia-central - FAIL ❌

Two ACs (CORE-06 and CORE-12) are only partly met. Each has a reproducible input that breaks the spec-defined outcome. The suite does not exercise either input. The other 22 ACs are covered by assertions that target the spec outcome. Gates are green, and the sensor killed all 12 valid mutants.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T49 | ✅ Done (49/49 marked Complete) | Checkmarks were not trusted: every AC below is re-derived from the tests. |
| T13 | ✅ Done | The commit message is `feat(model): export public model api`; tasks.md planned `feat(model): expose public api from index`. Cosmetic. |
| T44 (`FlowCanvas`) | ✅ Done, no automated test | By design (the canvas is kept out of jsdom). Its pass-through of `suggestionCount` to `StepNode` is covered by the manual check only. |
| T49 (Independent Test) | ✅ Done (manual) | Points 4-5 depend on the live LLM. See Quality notes. |

---

## Spec-Anchored Acceptance Criteria

### Mapa

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| CORE-01 | One node per top-level function and class | `packages/extract-python/src/__tests__/build-graph.test.ts:47` - `expect(graph.nodes.filter((n) => n.parentId === null)).toEqual([{id:"fn:calcular_frete",…},{id:"fn:processar_pedido",…}])`; `apps/web/src/__tests__/App.test.tsx:80-81` - `expect(graphMock).toHaveBeenCalledWith(source)`, `expect(currentCanvas().graph).toEqual(graph)`; `apps/web/src/flow/__tests__/project-level.test.ts:74` - `toEqual(["mod","a","b","K"])` | ✅ PASS |
| CORE-02 | A wire A→B when A calls B | `build-graph.test.ts:174` - `toEqual([{ id: "calls:fn:processar_pedido->fn:calcular_frete", kind: "calls", source, target }])`; `build-graph.test.ts:196` - `toEqual(["calls:fn:a->fn:b"])`; `project-level.test.ts:82` - `toContain("calls:K->b")` | ✅ PASS |
| CORE-03 | Loose statements grouped into a node "Módulo" | `build-graph.test.ts:79` - `expect(byId(graph, "mod")).toEqual({ id: "mod", kind: "module", label: "Módulo", … })` | ⚠️ PASS + spec-precision gap (SP-1) |
| CORE-04 | Same graph and same IDs for the same snippet | `packages/extract-python/src/__tests__/extractor.test.ts:21` - `expect(second).toEqual(first)` (two fresh extractors); `:22` `toMatchSnapshot()`; `:28` same extractor twice | ✅ PASS |
| CORE-05 | Graph built without the LLM | `packages/server/src/__tests__/graph-route.test.ts:45` - `expect(explainCalls).toEqual([])`; `pnpm check` dependency-cruiser: extract-python imports only model (structural) | ✅ PASS |
| CORE-06 | Valid parts kept; affected node marked "Erro de sintaxe na linha N" | `packages/extract-python/src/__tests__/errors.test.ts:43,48` - `toEqual(["fn:a","fn:b","fn:c"])`, `expect(line).toBe(lineOf(source, "soma(1"))`; `:58` - `toEqual([["fn:b", lineOf(source, "def b(")]])`; `:70` (unexpected indent); `:80` (module created and marked); `apps/web/src/flow/__tests__/StepNode.test.tsx:50` - `getByText("Erro de sintaxe na linha 4")`; `packages/model/src/__tests__/lines.test.ts:34` | ❌ GAP (G-2): "expected an indented block" errors produce **no** mark |
| CORE-07 | "Nenhuma função ou instrução encontrada." | `build-graph.test.ts:127-128` - `expect(graph.empty).toBe(true)`, `expect(graph.nodes).toEqual([])`; `App.test.tsx:88-91` - `findByText("Nenhuma função ou instrução encontrada.")`, canvas absent | ✅ PASS |

### Drill-down

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| CORE-08 | Opening a function shows internal steps in code order | `packages/extract-python/src/__tests__/steps.test.ts:44` - `toEqual([["fn:x/s0","code"],["fn:x/s1","external"],["fn:x/s2","code"]])` + `next` wires at `:49`; `apps/web/src/nav/__tests__/navigation.test.ts:29` - `expect(next.path).toEqual(["calc"])`; `project-level.test.ts:125` | ✅ PASS |
| CORE-09 | Condition node; wires labelled "sim", "não", or the elif text | `steps.test.ts:189` - branch edges `toEqual([… label: "sim" …, … label: "não" …])`; `:222` - `toEqual([["fn:f/s0/b0/s0","sim"],["fn:f/s0/b1/s0","x > 5"],["fn:f/s0/b2/s0","não"]])`; `project-level.test.ts:138` | ✅ PASS |
| CORE-10 | for/while → openable loop node with its body | `steps.test.ts:278` - `toEqual({ kind: "loop", label: "for item in itens", openable: true, … })` + body `:286`; `:309` while; `navigation.test.ts:37`; `project-level.test.ts:151` | ✅ PASS |
| CORE-11 | Opening a step that calls a snippet function shows the callee's flow | `steps.test.ts:93` - `toEqual([{ kind: "call", target: "fn:calcular_frete", openable: true, … }])`; `navigation.test.ts:51` - `expect(next.path).toEqual(["main", "helper"])` | ✅ PASS |
| CORE-12 | Library call classified HTTP/BANCO/ARQUIVO/E-MAIL/EXTERNO by the prefix table (table lists `.execute(`, `.commit(`) | `packages/extract-python/src/__tests__/classify.test.ts:20` - `expect(classify(callee)).toBe(category)` over 13 rows; `steps.test.ts:111` - `toEqual({ kind: "external", callee: "requests.get", category: "HTTP", … })`; `calls.test.ts:91` - `cur.execute` → `BANCO`; `StepNode.test.tsx:45` | ❌ GAP (G-1): chained or subscripted receivers are not classified |
| CORE-13 | Call-free, flow-free runs grouped into "Código" with the line range | `steps.test.ts:60` - `toEqual([{ kind: "code", label: "Código", range: { start: 2, end: 4 }, … }])`; `:139` code/call/code split | ✅ PASS |
| CORE-14 | Selecting a node shows its line range and exact source | `apps/web/src/panel/__tests__/DetailPanel.test.tsx:79-82` - `getByText("Linhas 5–5")`, `codeLines(container)).toEqual(['    requests.get("https://api.exemplo.com/tabela-frete")'])`; `CodeView.test.tsx:24`; `lines.test.ts:8-28` | ✅ PASS |
| CORE-15 | Navigation path shown; one click returns to any level | `apps/web/src/nav/__tests__/Breadcrumb.test.tsx:35` - `toBe("Trecho › calcular_frete › for item in itens")`; `:44,46` `onGoTo(0)`/`onGoTo(1)`; `navigation.test.ts:68,75`; `App.test.tsx:137-139` - `levelId` back to `null` | ✅ PASS |

### Explicação

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| CORE-16 | One LLM call for summary, inputs, outputs and 0-5 suggestions, with PTS rules as the system message | `packages/explain/src/__tests__/explain.test.ts:96` - `expect(requests).toHaveLength(1)`; `:98` - `messages[0]).toEqual({ role: "system", content: prompt.text })`; `:102` full `ok` body; `prompt.test.ts:16` - `toContain(ptsRules)`; `server/src/__tests__/main.test.ts:103` - system `toContain(ptsRules)` read from disk; `schema.test.ts:56` (cap 5); `DetailPanel.test.tsx:91-101` | ✅ PASS |
| CORE-17 | Only the node's code and direct neighbours' names are sent | `explain.test.ts:116-121` - `toContain("Chama: buscar_tabela, aplicar_taxa")`, `not.toContain("5 |")`, every message `not.toContain("SEGREDO_FORA")`; `server/src/__tests__/explain-route.test.ts:47` - `toEqual({ code: <lines 4-11>, calls: [], calledBy: ["processar_pedido"], … })`; `:66` forged fields ignored | ✅ PASS |
| CORE-18 | Same code + model + prompt version → disk cache, no LLM call | `explain.test.ts:128-129` - `toHaveLength(1)`, `second).toEqual({ ...first, fromCache: true })`; `:140` - another model or version → `toHaveLength(3)`; `cache.test.ts:68` (persists across instances) | ⚠️ PASS + spec-precision gap (SP-3) |
| CORE-19 | No key → map works; panel shows "Configure OPENROUTER_API_KEY para ver resumos" | `explain.test.ts:159` - `toEqual({ status: "no-key" })`; `main.test.ts:64-65` - no client built; `explain-route.test.ts:85-86` - `200 { status: "no-key" }`; `DetailPanel.test.tsx:110-116` - exact text + code still visible | ✅ PASS |
| CORE-20 | LLM failure → "Resumo indisponível" + "Tentar de novo"; map still usable | `DetailPanel.test.tsx:126-132` - text, retry click, `toHaveBeenCalledTimes(2)`; `App.test.tsx:127-129` - canvas still holds the graph; `explain.test.ts:176-177` - `status: "error"` and nothing cached; `explain-route.test.ts:95` - `502`; `api.test.ts:58,72` | ✅ PASS |
| CORE-21 | `CODE2N8N_MODEL`, else `~deepseek/deepseek-v4-flash-latest` | `packages/explain/src/__tests__/model-env.test.ts:8,14,18`; `main.test.ts:85` - `toBe("x/y")`, `:92` - default | ✅ PASS |
| CORE-22 | Suggestion with a line outside the node is dropped | `schema.test.ts:46` - lines `[0,1,4,5]` → `toEqual([1, 4])`; `explain.test.ts:194-204` - dropped from response and from the cache file | ✅ PASS |
| CORE-23 | Node shows a badge with the suggestion count | `StepNode.test.tsx:55` - `getByTitle("Sugestões").textContent).toBe("2")`; `:60,65` no badge for 0/absent; `App.test.tsx:116` - canvas receives `suggestionCounts.get(...) === 2` | ✅ PASS (`FlowCanvas` pass-through: manual only) |
| CORE-24 | Clicking a suggestion highlights its source line | `DetailPanel.test.tsx:145-148` - `[aria-current]` lines `toEqual(["5"])`; `CodeView.test.tsx:35` - `[null,"true",null]` | ✅ PASS |

**Status**: ❌ Gaps present. 22/24 ACs match the spec outcome; 2 ACs (CORE-06, CORE-12) are partly unmet; 4 spec-precision gaps are flagged.

### Gap evidence (re-derived by probe, scratch worktree, real extractor)

**G-1 (CORE-12).** `classify` takes the callee from `dottedName` (`packages/extract-python/src/calls.ts:19-26`). That function returns `null` for any receiver that is not a plain dotted name, and `resolveOne` (`calls.ts:31`) then drops the call. Probe output:

| Input statement | Result | Spec expectation (table: `.execute(` → BANCO) |
| --------------- | ------ | --------------------------------------------- |
| `conn.cursor().execute(q)` | `fn:f/s0 code` ("Código", no category) | external BANCO |
| `c[0].execute(q)` | `fn:f/s0 code` | external BANCO |
| `self.conn.execute(q)` | external BANCO | ✅ |
| `sqlite3.connect('x').execute(q)` | external BANCO, `callee=sqlite3.connect` (from the inner call) | ✅ category |

The step is not BANCO, and it is not an external step at all. The suite tests only plain names (`cur.execute`, `conn.commit`).

**G-2 (CORE-06).** `errorLines` (`packages/extract-python/src/errors.ts:27-42`) finds ERROR/MISSING nodes plus a column heuristic (the SPEC_DEVIATION). tree-sitter-python does not emit ERROR for an empty block, and the heuristic only compares statements inside a block. Python rejects every input below with `IndentationError: expected an indented block`, and the extractor marks nothing:

| Input | Graph produced | Marked? |
| ----- | -------------- | ------- |
| `def a():\nx = 1\n` | `fn:a [1-1]` + `mod` with `x = 1` | no |
| `def a():\n\ndef b():\n    return 2\n` | `fn:a [1-1]`, `fn:b` | no |
| `def a():\n    x = 1\n\ndef b():\n` | `fn:a`, `fn:b [4-4]` | no |
| `def a():\n    if x:\n    return 1\n` | condition with no branch, `return` as a sibling | no |
| `def a():\n    if x:\n        y = 1\n      z = 2\n` (unmatched dedent) | `fn:a/s1` | ✅ `ERR@4` |

The user sees a clean map for code that does not run.

### Spec-precision gaps

- **SP-1 (CORE-03).** "instruções fora de funções" does not say whether `import` counts. The implementation follows design rule 1 as amended (an import alone creates no `mod`; `steps.test.ts:146-154`). The Independent Test ("dois nós") forces this reading, but spec.md was never updated to say so.
- **SP-2 (CORE-12).** The table writes `.execute(` / `.commit(` as text fragments, and the spec does not define how a prefix matches. The design chose whole-segment matching (`requests_cache` → EXTERNO, `classify.test.ts:24`). The spec does not say whether a non-name receiver (`f().execute`) is covered. G-1 above reads it as covered.
- **SP-3 (CORE-17 × CORE-18).** CORE-18 fixes the key to code + model + prompt version, and the code matches it (`explain.ts:53-55`). CORE-17, however, also sends neighbour names. If a caller is renamed or added and the node's code is unchanged, the cached summary keeps the old neighbours. Both ACs are met; their interaction is unspecified.
- **SP-4 (Independent Test 4).** "uma sugestão que aponta para essa linha" depends on the live LLM, so no deterministic test can assert it. It is verified manually (T49) only.

---

## Discrimination Sensor

Scratch: `git worktree add <scratchpad>/wt HEAD` + `pnpm install --offline`. Each mutant was applied alone, the owning package's `vitest run` was run, and the file was restored from a backup.

| # | File:line | Mutation | AC | Killed? |
| - | --------- | -------- | -- | ------- |
| M1 | `packages/explain/src/schema.ts:33` | `s.line >= 1` → `s.line >= 0` | CORE-22 | ✅ Killed (2 failed) |
| M2 | `packages/explain/src/explain.ts:58` | `if (cached)` → `if (false && cached)` | CORE-18 | ✅ Killed (3 failed) |
| M3 | `packages/explain/src/explain.ts:42` | `s.line + start - 1` → `s.line + start` | CORE-22/24 | ✅ Killed (4 failed) |
| M4 | `packages/extract-python/src/classify.ts:9` | removed `".execute"` from BANCO | CORE-12 | ✅ Killed (2 failed) |
| M5 | `packages/extract-python/src/steps.ts:166` | `if (!hasElse)` → `if (hasElse)` | CORE-09 | ✅ Killed (1 failed) |
| M6 | `packages/extract-python/src/errors.ts:50` | innermost `span <=` → `span >=` | CORE-06 | ✅ Killed (1 failed) |
| M7 | `packages/extract-python/src/build-graph.ts:173` | `if (!edges.has(id))` → `if (true)` | CORE-02 | ➖ Equivalent (the `Map` key already dedupes); discarded and replaced by M7b |
| M7b | `packages/extract-python/src/build-graph.ts:174` | map key `id` → `` `${id}@${step.id}` `` (one wire per call) | CORE-02 | ✅ Killed (1 failed) |
| M8 | `packages/server/src/app.ts:62` | `calledBy` built from outgoing instead of incoming wires | CORE-17 | ✅ Killed (1 failed) |
| M9 | `apps/web/src/panel/DetailPanel.tsx:60` | `onSuggestion={setHighlighted}` → no-op | CORE-24 | ✅ Killed (1 failed) |
| M10b | `apps/web/src/flow/StepNode.tsx:39` | badge only when `suggestionCount > 2` | CORE-23 | ✅ Killed (1 failed) |
| M11 | `packages/extract-python/src/errors.ts:14` | disabled the misindent heuristic | CORE-06 | ✅ Killed (1 failed) |
| M12 | `apps/web/src/nav/navigation.ts:38` | `slice(0, index)` → `slice(0, index + 1)` | CORE-15 | ✅ Killed (3 failed) |
| M13 | `packages/explain/src/explain.ts:54` | cache key = code only (model and version dropped) | CORE-18 | ✅ Killed (2 failed) |

**Sensor depth**: expanded (13 valid mutants across all four code packages, 1 equivalent discarded)
**Sensor outcome**: 12/12 valid mutants killed (M1-M6, M7b, M8, M9, M10b, M11-M13); no survivors.
**Isolation**: `git status --porcelain` was empty before and is empty after; the worktree was removed and pruned.

The suite discriminates well on the behaviour it covers. G-1 and G-2 are inputs the suite does not cover, not weak assertions.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ (greenfield) |
| No scope creep | ✅ (the `stale` status and injectable `fetch` are justified in tasks.md notes) |
| Matches patterns | ✅ |
| Spec-anchored outcome check (asserted values match spec) | ✅ for 22 ACs; ❌ CORE-06/12 untested inputs |
| Per-layer Coverage Expectation met | ⚠️ Mostly. `graph-route.test.ts:59` asserts only `some(n => n.syntaxError !== undefined)` (no line, no node); the exact assertion lives in `errors.test.ts`. |
| Every test maps to a spec requirement | ✅ (non-AC tests map to Done-when items: host guard, 400/404, cache atomicity) |
| Documented guidelines followed | ✅ `CLAUDE.md` and the design's test matrix |

SPEC_DEVIATION markers: `packages/explain/src/schema.ts:14` (`line` is an int with no minimum, so that line 0 is dropped per CORE-22, a sound reading) and `packages/extract-python/src/errors.ts:23` (the indentation heuristic; it is incomplete, see G-2).

---

## Edge Cases

- [x] Empty or comments-only snippet → `empty: true` and the message
- [x] Repeated names → `#2`
- [x] `if` without `else`, with and without a following step
- [x] Corrupted cache file, failed cache write, LLM throws, invalid JSON
- [x] Suggestion at line 0 / beyond n / more than 5
- [x] Unknown or stale `nodeId` → 404 → "O trecho mudou…"
- [ ] Empty block (`expected an indented block`): NOT detected (G-2)
- [ ] Chained or subscripted DB receivers: NOT classified (G-1)

---

## Gate Check

- **Gate command**: `pnpm typecheck && pnpm check && pnpm test`
- **Outcome**: typecheck exit 0; check exit 0 (Biome: 85 files, no fixes; dependency-cruiser: no violations, 95 modules); test exit 0, with **201 passed, 0 failed, 0 skipped** (model 14, extract-python 77, explain 37, server 21, web 52)
- **Test count before feature**: 0 (`6227009` is the first commit)
- **Test count after feature**: 201
- **Delta**: +201
- **Skipped tests**: none (no `.skip`/`.only`/`.todo`)
- **Failures**: none

---

## Fix Plans

### Fix 1: Classify DB methods on non-name receivers (G-1, CORE-12)

- **Root cause**: `dottedName` (`calls.ts:19-26`) returns `null` for `call`/`subscript` objects, so `conn.cursor().execute(q)` never reaches `classify`.
- **Fix task**: in `resolveOne`, when `fn` is an `attribute` whose object is not a dotted name, classify `.<attribute>` alone. Emit `external` only when the result is not EXTERNO (BANCO for `.execute`/`.commit`), with `callee` = the attribute text (for example `….execute`).
- **Verify**: new `calls.test.ts` cases. `conn.cursor().execute(q)` → `{ kind: "external", category: "BANCO" }`. `c[0].commit()` → BANCO. `foo().append(x)` → `null`.
- **Priority**: Major

### Fix 2: Mark empty-block syntax errors (G-2, CORE-06)

- **Root cause**: tree-sitter-python recovers from a missing indented body without ERROR/MISSING, and the heuristic in `errors.ts` only compares sibling statements inside an existing block.
- **Fix task**: in `errorLines`, flag any `function_definition`, `class_definition`, `if`/`elif`/`else`, `for`/`while`, `try`/`with`/`match`, or clause whose `body`/`consequence` block is missing, has no named statements, or starts at a column ≤ the header's column. Report it at the line after the header (where CPython reports it).
- **Verify**: a new fixture `errors/bloco_vazio.py` (`def a():\nx = 1`, plus an `if x:` with no body inside a function). The test expects `fn:a` (or the innermost node) to carry `syntaxError.line` = 2, and the other functions are kept.
- **Priority**: Major

---

## Requirement Traceability Update

The verifier does not edit spec.md. The orchestrator should apply these statuses:

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| CORE-01..05, 07..11, 13..24 | Pending | ✅ Verified |
| CORE-06 | Pending | ❌ Needs Fix (G-2) |
| CORE-12 | Pending | ❌ Needs Fix (G-1) |

---

## Quality notes (not AC failures)

- **Live summary grounding.** The one live summary was: "Calcula o frete com base no peso e na distância. Aplica taxa dobrada para peso acima de 30 kg." The fixture *does* use distance: `distancia` appears as a parameter (`pedido_frete.py:4`), in `taxa = distancia * 0.5` (`:7`) and at the call site (`:17`). So "distância" is grounded, and "taxa dobrada" matches `base + taxa * 2` (`:9`). The unit **"kg" is invented**: the code has no unit. The summary also **omits the HTTP call** (`requests.get`, `:5`), even though it is the node's only external effect. The prompt already says "Não invente comportamento" (`packages/explain/src/prompt.ts:5`). No AC covers summary fidelity; the deferred item "Qualidade: pedir de novo um resumo fora do PTS" is the closest. This is a quality gap to measure, not an AC failure.
- **Cache key and neighbours.** See SP-3.

---

## Summary

**Overall**: ❌ Not Ready

**Spec-anchored check**: 22/24 ACs matched the spec outcome; 2 AC gaps (CORE-06, CORE-12); 4 spec-precision gaps flagged
**Sensor**: 12/12 valid mutations killed (1 equivalent discarded)
**Gate**: 201 passed, 0 failed, 0 skipped; typecheck and check clean

**What works**: the extractor is deterministic, and the video-fixture map matches Independent Test 1-3 at the graph level. Drill-down, branch labels, loops and blocks, calls-wire lifting, the cached single LLM call, no-key and error states, line filtering, the badge and line highlighting all work.

**Issues found**: G-1 (chained DB calls not classified); G-2 (empty-block syntax errors not marked).

**Next steps**: route Fix 1 and Fix 2 to an implementer, then re-verify (iteration 1 of 3).
