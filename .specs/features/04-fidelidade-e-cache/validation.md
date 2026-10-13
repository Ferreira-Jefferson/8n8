# 04-fidelidade-e-cache Validation

**Date**: 2026-10-13
**Spec**: `.specs/features/04-fidelidade-e-cache/spec.md` (FID-01..15, CACHE-01..07)
**Diff range**: `145e84b..890dfe3`, excluding `775a28a` (feature-02 docs). Feature-01 regression is checked against `.specs/features/01-fatia-central/spec.md` (CORE-01..24).
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 04-fidelidade-e-cache - FAIL ❌

All 22 ACs have `file:line` evidence that targets the spec outcome, and the full gate is green: 334 unit tests and 22 E2E tests. The verdict is FAIL for one reason: one discrimination-sensor mutant survived. If FID-03 checks a letter unit as a substring of the code instead of as a code token, no test notices (M4b). By the rule in validate.md, a surviving mutant is a fix task, and the feature is not done until that task is closed. The fix is a single test case (Fix 1). Two spec-precision gaps (SP-1 FID-03, SP-2 CACHE-07) and one minor test gap (FID-14 position) are flagged, and none of them blocks the verdict on its own.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T26 | ✅ Done (26/26, no open checkbox) | Checkmarks were not trusted. Every AC below is re-derived from the tests. |
| T11 (`7efa6d5`) | ⚠️ Process deviation | Committed with 4 red tests in `explain.test.ts`, which the message declares. Re-run in a scratch worktree: exactly 4 fail (CORE-18, position shift, CORE-19 cached, CORE-22). The next commit `3e54997` (T12) is 128/128. The history note is accurate. |
| T13 (`7743bc4`) | ⚠️ Process deviation | Committed with 4 red tests in `main.test.ts`, which the message declares. Re-run: exactly those 4 fail. The next commit `4e9c729` (T14) turns them green. The history note is accurate. (A fifth failure in the scratch, `explain-route.test.ts` CORE-17, is a CRLF checkout artifact. See Quality notes.) |

HEAD (`890dfe3`) is green. The two red commits are recorded as a process deviation (each commit should be green), not as an AC failure.

---

## Spec-Anchored Acceptance Criteria

### P1: Revisão (FID-01..11)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| FID-01 | Every draft goes through both layers before it is shown or cached | `packages/explain/src/__tests__/explain.test.ts:397-398` - `stored.review` `toBe("cut")` and `stored.result` `toEqual(explained(1))`, so only the reviewed, cut result is stored; `explain.test.ts:385-387` - unfaithful gives `readdir(dir)` `toEqual([])`; `review.test.ts:111` - no reviewer message contains `"pesa 5 kg"`; `e2e/fidelidade.e2e.ts:183` - `cachedFiles()` `toEqual([])` | ✅ PASS |
| FID-02 | A number absent from the code makes the claim unsupported | `checks.test.ts:51-56` - `checkNumbers("A caixa pesa 5 kg.", …)` `.not.toBeNull()`; `:68-72` - 5 is not accepted because of `0.5`; `:178-195` - `layerOne` returns `[["s2","A caixa pesa 5 kg."], …]`, and the problem contains `"5"` | ✅ PASS |
| FID-03 | A listed unit absent from the code (comments and strings included) makes the claim unsupported | `checks.test.ts:92-93` - `"Pesa 5 kg."` flagged; `:96-99` - `kg` in a comment or a string is accepted; `:109-118` - `R$`, `%`, `€`; `:120-125` - `5 g` and `5g`; `:133-137` - case; `e2e/fidelidade.e2e.ts:64-94` | ✅ PASS, ⚠️ SP-1. The sensor found a weak spot (M4b). |
| FID-04 | A backticked identifier absent from the code and the neighbour names makes the claim unsupported | `checks.test.ts:141-175` - `` `somar()` `` flagged, a neighbour name accepted, `` `peso_total` ``/`` `peso` `` bounded (`.not.toBeNull()`) | ✅ PASS |
| FID-05 | After layer 1, the LLM reviewer classifies each claim and gives evidence lines | `review.test.ts:274-283` - the reviewer user turn contains `"- s1: …"`, `"- i1: …"`, `"- o1: …"`; `reviewer.test.ts:33-41` - the prompt asks for `"verdicts"`, `"supported"`, `"evidence"`; `explain.test.ts:142-151` - 2 requests, and the second has `reviewer.text` as its system message | ✅ PASS |
| FID-06 | The reviewer gets only the node code, the neighbour names and the draft | `reviewer.test.ts:81-93` - `not.toContain("Nó:")`, no node name outside the code, no PTS text, no raw `"summary"`/`"suggestions"`; `review.test.ts:283` - `not.toContain("s2")` (layer-1 rejects are not sent); `e2e/fidelidade.e2e.ts:128-131` - real pipeline: contains `processar_pedido`, not `"Nó:"`, not the PTS first line | ✅ PASS |
| FID-07 | A supported claim with no evidence, or with evidence outside the node, is unsupported | `reviewer.test.ts:179-187` - `ok("s1", [])` puts `problems` at `["s1"]`; `:189-197` - `[0,1]` and `[2,5]` with `lineCount` 4 put `problems` at `["s1","s2"]` | ✅ PASS |
| FID-08 | New draft with the problem list, at most 2 times | `review.test.ts:140-166` - `drafts()` `toHaveLength(3)`; the redraft roles are `system,user,assistant,user`; the last user turn starts with `"Problemas encontrados:"` and matches `- s2 «A caixa pesa 5 kg\.»: .+`; `:169-177` - reviewer rejections are listed too; `e2e/fidelidade.e2e.ts:80-90` | ✅ PASS |
| FID-09 | After 2 redrafts, the unsupported claims are removed from what is shown and stored, with the badge "Revisado com cortes" | `review.test.ts:93-112` - `toEqual(…)` with `kind "ok"`, `review "cut"` and a result whose summary is `"Devolve o peso da caixa."` with only `s1`; `:199-247` - cut inputs, outputs and suggestions dropped, id gaps kept; `DetailPanel.test.tsx:265-283` - `.review-badge` text `"Revisado com cortes"`; `e2e/fidelidade.e2e.ts:75-77` - badge, `summaryItems` `["Devolve o peso da caixa."]`, `not.toContainText("5 kg")` | ✅ PASS |
| FID-10 | No surviving summary sentence: "Não foi possível gerar um resumo fiel." with "Tentar de novo", and no cache write | `review.test.ts:180-195` - `{kind:"unfaithful"}` (layer-1 and reviewer paths); `explain.test.ts:380-387` - `{status:"unfaithful"}`, and `readdir(dir)` is `[]`; `explain-route.test.ts:97` - 200 with the same body; `DetailPanel.test.tsx:345-366` - exact text and retry; `e2e/fidelidade.e2e.ts:159-184` - text, button, no badge, retry gives `{status:"unfaithful"}`, `cachedFiles()` `[]` | ✅ PASS |
| FID-11 | All claims pass: badge "Revisado" | `review.test.ts:115-121` - `toMatchObject({kind:"ok", review:"full"})` with 2 calls; `DetailPanel.test.tsx:265-283` - `"Revisado"`; `e2e/fidelidade.e2e.ts:103` - `badge` `toHaveText("Revisado")` | ✅ PASS |

### P1: Evidência e cobertura (FID-12..15)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| FID-12 | Evidence lines next to each claim, e.g. "L5" or "L5–7" | `apps/web/src/panel/__tests__/format-lines.test.ts` - `[5,6,7]` gives `"L5–7"` and `[5,6,7,9]` gives `"L5–7, L9"`; `DetailPanel.test.tsx:296-301` - a button named `"L8–9"` inside `[data-claim-id="s2"]`; `e2e/fidelidade.e2e.ts:104-106` - `["L5"]`, `["L8–9"]`, `["L9, L11"]` | ✅ PASS |
| FID-13 | Clicking the evidence highlights those lines in the code | `DetailPanel.test.tsx:299,303` - `marked(container)` `toEqual(["8","9"])`, then `["4"]`; `CodeView.test.tsx:47`; `e2e/fidelidade.e2e.ts:114-117` - 0 marked before the click, 2 after, `["8","9"]` | ✅ PASS |
| FID-14 | Below the summary, without the LLM, each external effect (HTTP, BANCO, ARQUIVO, E-MAIL, EXTERNO) with its call and line, taken from the graph | `effects.test.ts:29` - `requests.get` on line 5 for `calcular_frete`; `:41,61,81` - nested, class and order cases; `DetailPanel.test.tsx:368-385` - `["requests.get (HTTP, linha 5)"]`; `:405-456` - also shown under no-key, error and loading; `e2e/fidelidade.e2e.ts:139-157` - offline server, item `"requests.get (HTTP, linha 5)"`, `fakeLog()` `toEqual([])` | ✅ PASS (minor gap: "abaixo do resumo" holds only by DOM order, `DetailPanel.tsx:78-85`, and no test asserts the position) |
| FID-15 | `CODE2N8N_REVIEW_MODEL` for the reviewer, else the summary model | `model-env.test.ts:22-49` - `"r/x"`, then the fallback to `CODE2N8N_MODEL` and to the default, with an empty value treated as unset; `main.test.ts:127,142` - wired through `composeExplain`; `review.test.ts:250-272` - the reviewer request carries `reviewModel`; `e2e/fidelidade.e2e.ts:126-127` - draft model `["e2e/drafter"]`, review model `["e2e/reviewer"]` | ✅ PASS |

### P2: Cache (CACHE-01..07)

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| CACHE-01 | A fingerprint with separate components: normalized code, neighbours, summary model, reviewer model, prompt version, reviewer version | `fingerprint.test.ts:39-50` - `toEqual({code: sha(code), neighbours: sha(JSON{calls sorted, calledBy}), model, reviewModel, promptVersion, reviewerVersion})`; `:24-36` - CRLF→LF, trailing spaces and tabs; `explain.test.ts:297-311` - CRLF and trailing spaces still hit the cache | ✅ PASS |
| CACHE-02 | All components equal: use the cache, no LLM call | `explain.test.ts:178-184` - `requests` `toHaveLength(2)` after 2 openings, `{...first, fromCache:true}`; `:186-195` - a cut result too; `e2e/cache.e2e.ts:80-82` - `fromCache` true, `freteCalls` length 2 | ✅ PASS |
| CACHE-03 | Any component differs: regenerate, review, replace the node's entry | `explain.test.ts:197-260` - 4 or 6 requests per change; `:244` - `readdir(nodesDir())` `toHaveLength(1)`, and the replaced entry is then served from the cache (`:245-248`); `e2e/cache.e2e.ts:98,104,110` | ✅ PASS |
| CACHE-04 | "Resumo atualizado: <motivo>", where the reason is one of the 3 fixed texts, comma-separated | `fingerprint.test.ts:70-112` - `["code"]`, `["neighbours"]`, 4× `["model-or-prompt"]`, all three in fixed order; `DetailPanel.test.tsx:306-329` - `textContent` `toBe("Resumo atualizado: os vizinhos mudaram")` and `"Resumo atualizado: o código mudou, o modelo ou o prompt mudou"`; `e2e/cache.e2e.ts:100-102,123-125` - "os vizinhos mudaram" and "o código mudou" on the real server | ✅ PASS |
| CACHE-05 | Same code at another position: cache, with evidence and suggestion lines adjusted | `explain.test.ts:262-276` - `toEqual({…fromCache:true, explanation: explained(11)})`, which covers sentences, inputs, outputs, `suggestion.line` and `suggestion.lines`; `:278-294` - Independent Test P2 (+3); `e2e/cache.e2e.ts:140-149` - `fromCache` true, log stays at 2, `["L8"]`, `["L11–12"]`, `["L12, L14"]`, marks `["8"]`, no update notice | ✅ PASS |
| CACHE-06 | At most one entry per node identity | `cache.test.ts:99-107` - `readdir(nodes())` `toEqual([fileName("fn:a")])` after 2 sets with different fingerprints; `explain.test.ts:244`; `e2e/cache.e2e.ts:110` - `cachedFiles()` length 1 | ✅ PASS |
| CACHE-07 | An unreadable or old-format entry is treated as missing and overwritten | `cache.test.ts:68-75` - a corrupted file returns `undefined` and is overwritten; `:119-126` - `schemaVersion:1` returns `undefined`; `:129-137` - another shape; `:140-146` - a feature-01-style file at the root is never read; `explain.test.ts:313-333` - regenerates over v1 with no `update`, and the stored `schemaVersion` is 2 | ✅ PASS, ⚠️ SP-2 |

**Status**: ✅ 22/22 ACs evidenced against the spec outcome · ⚠️ 2 spec-precision gaps · ❌ 1 surviving mutant (FID-03)

### Independent Tests

- **P1**: the "5 kg" draft is cut with "Revisado com cortes" (`e2e/fidelidade.e2e.ts:64-94`). A faithful draft gives "Revisado", with clickable evidence lines that are highlighted (`:96-117`). `requests.get (HTTP, linha 5)` shows with no LLM call (`:139-157`). ✅
- **P2**: renaming `processar_pedido` gives "Resumo atualizado: os vizinhos mudaram" (`e2e/cache.e2e.ts:85-111`). Three blank lines give a cache hit, with lines +3 (`:128-150`, unit `explain.test.ts:278-294`). ✅
- Changing the model or the prompt is unit-only, as the spec allows (`explain.test.ts:197-235`). ✅

### Feature-01 regression (CORE-01..24)

| AC | Evidence at HEAD | Result |
| -- | ---------------- | ------ |
| CORE-01..15 | `packages/extract-python` is unchanged by this feature (85/85, the same count as at `145e84b`); `e2e/fatia-central.e2e.ts:142-376` passes | ✅ 15/15 |
| CORE-16 | Knowingly superseded: one draft plus one review call (`explain.test.ts:139-158`, `requests` length 2, with PTS as the system prompt of the draft). One `/api/explain` per opening: `e2e/fatia-central.e2e.ts:398` | ✅ (superseded by FID-01/05, as intended) |
| CORE-17 | `explain.test.ts:160-176` - only the name, kind, sorted neighbours and numbered code; `"SEGREDO_FORA"` never sent; `explain-route.test.ts:50` | ✅ |
| CORE-18 | `explain.test.ts:178-184`; `e2e/fatia-central.e2e.ts:452`. Neighbours now also invalidate the entry, which is the extension the spec records | ✅ |
| CORE-19 | `explain.test.ts:351-362`; `main.test.ts:78`; `DetailPanel.test.tsx:171`; `e2e/fatia-central.e2e.ts:378` | ✅ |
| CORE-20 | `explain.test.ts:364-378`; `DetailPanel.test.tsx:190`; `e2e/fatia-central.e2e.ts:480` | ✅ |
| CORE-21 | `model-env.test.ts:6-20`; `main.test.ts:99` | ✅ |
| CORE-22 | `explain.test.ts:401-422` - lines 0, 5 and 99 dropped from the response and the cache | ✅ |
| CORE-23, CORE-24 | `e2e/fatia-central.e2e.ts:398-450`; `DetailPanel.test.tsx:211-227` (`marked` `["5"]`) | ✅ |

The fatia-central E2E migration (`7283862`) keeps or tightens every assertion: summary items, the lists after each heading, and suggestion buttons matched by exact name. No test was deleted.

---

## Spec-Precision Gaps

- **SP-1 (FID-03)**: the spec lists the units but does not say how they match. The implementation (`checks.ts:81-92`) decides three things:
  - single-letter units (`g t m l s h`) count only right after a number (`\d\s?u`);
  - word units count at letter boundaries;
  - presence in the code is checked by code token (identifiers split on `_`, symbols and digit/letter edges) for letter units, and by substring for symbol units.
  So "pesa em g" is not flagged, and neither is "a gente", by design. A probe of 20 ordinary Portuguese sentences found no false positive: "usa 2 métodos", "2 e", "2 a", "o passo 2 é" all pass. Only actual unit uses are flagged ("2 m de corda", "10 h", "2 s", "30%"), along with a list word used as plain prose ("Repete por dias.") when the code has no `dias`, which matches the literal spec. This is acceptable against the assumption, but the spec should state the rule.
- **SP-2 (CACHE-07)**: "gravar uma nova por cima" assumes that the old entry and the new one share a file. Feature-01 entries live at `<dir>/<key>.json`, and feature-04 entries at `<dir>/nodes/<sha256(nodeId)>.json` (`cache.ts:64`). The old files are never read, so they are treated as missing ✅, but they are also never overwritten: they stay as orphans. `design.md` C6 places their removal under the deferred "limpeza de entradas". The spec should say so.
- FID-06 note (not flagged): the reviewer gets only the claims that passed layer 1, not the whole draft. That is a subset of what "só … o rascunho" allows.

---

## Discrimination Sensor

Run in a scratch `git worktree` at `890dfe3`, under the session scratchpad. The baseline `git status --porcelain` of master was empty before and after, and the worktree was removed. The unmutated scratch baseline was explain 128/128, web 78/78 and server 29/29 (after the scratch fixture was normalized to LF; see Quality notes).

| # | File:line | Mutation | Killed? |
| - | --------- | -------- | ------- |
| M1 | `packages/explain/src/checks.ts:60` | FID-02: remove the `(?<![\w.])` boundary, so `5` matches `0.5` | ✅ Killed (2) |
| M2 | `checks.ts:86` | FID-03: single-letter unit no longer needs a number before it | ✅ Killed (1) |
| M3 | `checks.ts:107` | FID-04: neighbour names no longer accepted | ✅ Killed (1) |
| M4 | `checks.ts:89` | FID-03: unit always counted as present | ✅ Killed (5) |
| M4b | `checks.ts:89-91` | FID-03: letter units checked by **substring** of the code instead of by code token | ❌ **Survived** (128/128) |
| M5 | `reviewer.ts:114` | FID-07: `n > lineCount` → `n > lineCount + 1` | ✅ Killed (1) |
| M6 | `reviewer.ts:113` | FID-07: empty evidence accepted | ✅ Killed (1) |
| M7 | `review.ts:39` | FID-08: `ROUNDS` 3 → 4 (3 redrafts) | ✅ Killed (5) |
| M8 | `review.ts:39` | FID-08: `ROUNDS` 3 → 2 (1 redraft) | ✅ Killed (5) |
| M9 | `review.ts:121` | FID-09: always `"full"` (the cut is never reported) | ✅ Killed (4) |
| M10 | `review.ts:118` | FID-10: unfaithful only when no claim of any kind survives | ✅ Killed (2) |
| M11 | `review.ts:97` | FID-05/06: send all claims (layer-1 rejects included) to the reviewer | ✅ Killed (2) |
| M12 | `fingerprint.ts:72` | CACHE-01: reviewer model dropped from `diffReasons` | ✅ Killed (2) |
| M13 | `fingerprint.ts:43` | CACHE-01: callers dropped from the neighbour key | ✅ Killed (1) |
| M14 | `fingerprint.ts:31` | Normalization keeps trailing tabs | ✅ Killed (2) |
| M15 | `explain.ts:42` | CACHE-05: relative→absolute off by one | ✅ Killed (8) |
| M16 | `explain.ts:52` | CACHE-05: `suggestion.line` not shifted | ✅ Killed (8) |
| M17 | `explain.ts:73,105` | CACHE-03/06: entry keyed by node + neighbours (content-addressed) | ✅ Killed (3) |
| M19 | `cache.ts:31` | CACHE-07: any `schemaVersion` accepted | ✅ Killed (1) |
| M20 | `apps/web/src/panel/DetailPanel.tsx:27` | CACHE-04: reason text `"os vizinhos mudou"` | ✅ Killed (1) |
| M21 | `DetailPanel.tsx:146` | CACHE-04: reasons joined with `" e "` | ✅ Killed (1) |
| M22 | `packages/server/src/app.ts:54` | Identity: `nodeId: node.label` (and a variant that omits `nodeId`) | ✅ Killed (1, re-run on an LF fixture) |
| M23 | `apps/web/src/panel/format-lines.ts:7` | FID-12: adjacent lines not merged into ranges | ✅ Killed (3) |

**Sensor depth**: P0-style manual run: 23 mutations over layer-1 rules, the FID-07 evidence rule, the redraft limit, the cut, the fingerprint components, the reason text, relative-line conversion and one entry per node.
**Result**: 22/23 killed - ❌ FAIL (M4b survived).

M4b matters because single-letter units (`s`, `m`, `t`, `l`, `g`, `h`) occur as substrings of almost any code (`status`, `timeout`, `item`). Under a substring check, "Espera 30 s." would pass against `timeout = 30`, and FID-03 would never fire for those units. The implementation is correct today (token check). Only the test that pins it is missing. No E2E scenario exercises the difference: the "5 kg" code contains no `kg` substring.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ Small modules (`checks`, `sentences`, `reviewer`, `review`, `fingerprint`, `cache`), with no speculative options |
| Surgical changes | ✅ Feature-01 code touched only where the contract changed (`schema.ts`, `prompt.ts`, `app.ts` +2 lines, `CodeView` set of lines) |
| No scope creep | ✅ `CODE2N8N_PORT`, `OPENROUTER_BASE_URL` and `CODE2N8N_CACHE_DIR` exist only to run the E2E against the fake LLM, as the spec assumption requires |
| Matches patterns | ✅ zod at the boundaries, atomic temp+rename writes, Biome and depcruise clean |
| Spec-anchored outcome check | ✅ Exact texts asserted ("Revisado com cortes", "Resumo atualizado: …", "Não foi possível gerar um resumo fiel.") |
| Per-layer coverage | ✅ Domain ACs 1:1 in unit tests; route covers ok/no-key/unfaithful/error/404/400; both Independent Tests in E2E against the real pipeline |
| Every test maps to a requirement | ✅ Test titles carry AC ids. The rest are CORE or Done-when cases |
| Documented guidelines | ✅ `tasks.md` Gate Check Commands and Test Rules (no network in unit tests: fake `LlmClient` and fake `fetch`) |

---

## Edge Cases and Specific Checks

- [x] **Real `.env` key vs the fake LLM**: `playwright.config.ts:24-64` sets `reuseExistingServer:false` on all three servers. The offline server sets `OPENROUTER_API_KEY:""`. The keyed server sets `OPENROUTER_API_KEY:"e2e-fake-key"` and `OPENROUTER_BASE_URL:"http://127.0.0.1:4318/v1"` explicitly. `main.ts:58` uses `process.loadEnvFile`, and a probe on Node v24.14.0 confirmed that it does not overwrite a variable that is already set, even an empty one (`""` stays `""`, `fake` stays `fake`). The real key cannot reach either E2E server, and the keyed server can only talk to 127.0.0.1:4318. The fake answers 500 to unscripted requests and never forwards (`e2e/fake-llm.ts:178`). ✅
- [x] **FID-03 single-letter false positives**: none on ordinary prose (see SP-1). ✅
- [x] **CACHE-07 old feature-01 entry**: treated as missing (`cache.test.ts:140-146`, `explain.test.ts:313-333`). It is orphaned rather than overwritten (SP-2). ✅/⚠️
- [x] Invalid draft or invalid verdicts give `error`, and nothing is written (`review.test.ts:286-294`, `explain.test.ts:364-378`).
- [x] A failed cache write still answers `ok` (`explain.test.ts:442-459`).
- [x] Effects show under no-key, error and loading (`DetailPanel.test.tsx:405-456`).

---

## Gate Check

- **Gate command**: `pnpm typecheck && pnpm check && pnpm test && pnpm e2e` (Build final, `tasks.md:57`), run on master at `890dfe3`. Exit 0.
- **Result**: typecheck ✅ (5 packages + `tsc -p e2e`); Biome ✅ (106 files); depcruise ✅ (110 modules, 0 violations); unit 334 passed / 0 failed / 0 skipped (model 14, extract-python 85, explain 128, web 78, server 29); E2E 22 passed / 0 failed.
- **Test count before feature** (`145e84b`): 209 unit (14 + 85 + 37 + 52 + 21), 14 E2E.
- **Test count after feature**: 334 unit, 22 E2E.
- **Delta**: +125 unit, +8 E2E. No test deleted. The migrated feature-01 tests kept or tightened their assertions.
- **Skipped tests**: none.

---

## Fix Plans

### Fix 1: FID-03 token-vs-substring not pinned (M4b) - Major (blocks PASS)

- **Root cause**: no `checkUnits` case has a letter unit that appears in the code only inside a longer identifier.
- **Fix task**: in `packages/explain/src/__tests__/checks.test.ts` (FID-03 block), add `expect(checkUnits("Espera 30 s.", ctx("status = 30"))).not.toBeNull()` and `expect(checkUnits("Mede 2 m.", ctx("item = 2"))).not.toBeNull()`. No production change.
- **Done when**: M4b (`const present = lowerCode.includes(unit.toLowerCase())` for letter units) is killed, and `pnpm --filter @code2n8n/explain test` is green.

### Fix 2: FID-14 position not asserted - Minor (does not block)

- **Fix task**: in `DetailPanel.test.tsx`, assert that the "Efeitos externos" heading comes after the `Resumo` list in document order (`compareDocumentPosition`).

### Spec follow-ups (no code)

- SP-1: state the FID-03 matching rule in the spec assumptions (number before single letters; token vs substring).
- SP-2: state in CACHE-07 that feature-01 files are ignored and left for the deferred cleanup.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| FID-01..02, FID-04..15 | Pending | ✅ Verified |
| FID-03 | Pending | ❌ Needs Fix (test-only: Fix 1) |
| CACHE-01..07 | Pending | ✅ Verified |

---

## Quality / Process Notes

- **Red commits**: `7efa6d5` (T11) and `7743bc4` (T13) were committed with declared red tests (4 each, confirmed exactly), and the next task fixed them. HEAD is green. This is a process deviation from "every commit green" and is not counted as an AC failure.
- **CRLF fragility (pre-existing, feature 01)**: `core.autocrlf=true` and there is no `.gitattributes`. A fresh checkout writes `pedido_frete.py` with CRLF, and then `explain-route.test.ts:58` (CORE-17), which slices the fixture by `"\n"`, fails. It fails the same way at `145e84b`, so feature 04 did not cause it. Master's working copy is LF, which is why the gate is green. The E2E specs normalize CRLF (`fidelidade.e2e.ts:20`), but the route test does not.
- The prompt asks the drafter to backtick identifiers and to avoid absent numbers and units (`prompt.ts`). This prevention step sits on top of the review and lowers how many redrafts are needed.

---

## Summary

**Overall**: ❌ Not Ready. One test-only fix (Fix 1) closes it.

**Spec-anchored check**: 22/22 ACs evidenced; 2 spec-precision gaps (SP-1, SP-2); CORE regression 24/24 (CORE-16 superseded by design)
**Sensor**: 22/23 mutations killed (M4b survived)
**Gate**: 334 unit + 22 E2E passed, 0 failed

**What works**: two-layer review with redrafts, cut and unfaithful outcome; evidence lines with highlighting; graph-derived effects with no LLM; per-node cache with a component fingerprint, update reasons, position shift and v2 migration; the E2E runs the real pipeline against an isolated fake LLM, with no way for the real key to leak.

**Issues found**: M4b (Fix 1); FID-14 position untested (Fix 2); SP-1 and SP-2 spec wording.

**Next steps**: route Fix 1 to an implementer, then re-verify (iteration 1 of at most 3).
