# Validation: 07-cli - PASS ✅

**Verdict**: PASS ✅ (round 5, range `80c3168..7b5bfe0`)
**Reason**: all 24 ACs match the spec with `file:line` evidence. All gates are green. Every behavior mutant inside the spec's promises is killed. The two surviving probes (Q6, Q7) lie outside what DIST-23 promises; they are listed as known limits.

**Date**: 2026-10-15
**Spec**: `.specs/features/07-cli/spec.md` (DIST-07, DIST-08, DIST-15, DIST-23 and DIST-24 amended during the feature)
**Diff range**: `80c3168..7b5bfe0` (17 commits)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1-T11 | ✅ Done | tasks.md: `Status: Done`, no unchecked items |
| Fix rounds f915e12, d23f482, 398639e, 6d9e807, 7b5bfe0 | ✅ Done | All verifier gaps of rounds 1-4 closed |

---

## Earlier Gaps: Re-check

| Round | Gap | Evidence now | Result |
| ----- | --- | ------------ | ------ |
| 1 | DIST-23 text vs code | spec DIST-23 names `open-browser.ts`, `guards.test.ts` and the `links.ts` lines | ✅ Closed |
| 1 | DIST-15 spec-precision | `repo-scripts.test.ts:15-17`, `:21-23` | ✅ Closed |
| 1 | DIST-14 package branch | `guards.test.ts:180-189` | ✅ Closed |
| 1 | DIST-12 cwd = repo | `e2e/cli.e2e.ts:104`, `:131` | ✅ Closed |
| 1 | DIST-22 real CLI output | `e2e/cli.e2e.ts:254-257` | ✅ Closed |
| 2 | N6 exemption widened | `guards.test.ts:136-151`; re-run as P5 in round 4: killed | ✅ Closed |
| 3 | N8 severity `warn` | `guards.test.ts:103-105`, `:147` `error no-child-process: <file>`; re-run as P1 in round 4: killed | ✅ Closed |
| 4 | P6/P9 whole-file allowance for `links.ts` | `guards.test.ts:225-237` pins the two exact lines; Q1 (P6) and Q2 (P9) killed | ✅ Closed |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| DIST-01 | Server on `127.0.0.1`, default browser opens the folder map | `apps/cli/src/__tests__/run.test.ts:78` `expect(h.port()).toBe(8148)`; `:80` `url.startsWith("http://127.0.0.1:8148/#")`; `:81` `get("pasta")).toBe(h.project)`; `apps/cli/src/__tests__/open-browser.test.ts:178-179`; `apps/ui/src/__tests__/App.test.tsx:298-299`; `e2e/cli.e2e.ts:197-207` | ✅ PASS |
| DIST-02 | No argument: start screen | `run.test.ts:89` `get("pasta")).toBeNull()`; `:90` token present | ✅ PASS |
| DIST-03 | Relative path from the terminal folder | `run.test.ts:96` | ✅ PASS |
| DIST-04 | `C:\proj` and `C:/proj` | `run.test.ts:106-107` (`runIf(win32)`, ran on this host) | ✅ PASS |
| DIST-05 | `Pasta não encontrada: <caminho>`, exit 1, no browser | `run.test.ts:114-116` `toBe(1)`, exact message, `events toEqual([])`; `:122-123`; `e2e/cli.e2e.ts:240-241` | ✅ PASS |
| DIST-06 | `A porta <porta> já está em uso. Feche o outro processo e tente de novo.`, exit 1 | `run.test.ts:133-137`; `e2e/cli.e2e.ts:246-249` | ✅ PASS |
| DIST-07 | `8n8 em http://127.0.0.1:<porta>/#t=<token>` before the browser | `run.test.ts:144-148` | ✅ PASS |
| DIST-08 | `--help` usage parts, exit 0, no server | `run.test.ts:163-177`; `e2e/cli.e2e.ts:232-234` | ✅ PASS |
| DIST-09 | `~/.8n8/cache`, `~/.8n8/historico.db`, env overrides | `run.test.ts:199`, `:207-208`; `packages/server/src/__tests__/core.test.ts:308-309`; `e2e/cli.e2e.ts:219-227` | ✅ PASS |
| DIST-10 | No write in the analysed or install folder | `e2e/cli.e2e.ts:263-264` sha256 stamps `toEqual` | ✅ PASS |
| DIST-11 | No LLM config: map opens, existing no-key notice | `run.test.ts:226` `toEqual({ status: "no-key" })`; `App.test.tsx:235-237` notice text | ✅ PASS |
| DIST-12 | Installed `.tgz` runs with Node only, no repo file | `e2e/cli.e2e.ts:146-160` pack + `npm install -g --offline`; `:104`, `:131` `cwd: tmp`; `:197-209`; `build.test.ts:38`, `:61-63` | ✅ PASS |
| DIST-13 | `server` gets config by parameter; no `process.env`, port or repo paths | `core.test.ts:892-895`; `:859`, `:883`, `:887` | ✅ PASS |
| DIST-14 | Package / `apps/ui` / host importing `apps/cli` or another host fails `pnpm check` | `guards.test.ts:174-178` `error hosts-do-not-import-each-other` for web, vscode, cli; `:180-189` each package gets an `error` from its own boundary rule; `:190` `status not 0` | ✅ PASS |
| DIST-15 | `dev:server` and `start` run the CLI with `--env-file-if-exists=.env` | `repo-scripts.test.ts:15-17`, `:21-23` | ✅ PASS |
| DIST-16 | No `dependencies`, no install scripts | `build.test.ts:48-50`, `:55-56` | ✅ PASS |
| DIST-17 | Key never to browser or terminal | via DIST-22 | ✅ PASS |
| DIST-18 | 32 random bytes from `node:crypto`, `#t=` fragment | `run.test.ts:82` `/^[0-9a-f]{64}$/`; `:148`; `:250-252`; `run.ts:84` | ✅ PASS |
| DIST-19 | Token only in `sessionStorage`, fragment cleared, `x-8n8-token` on every `/api/*` call | `session.test.ts:35`, `:41`; `api.test.ts:314` (9 functions); `e2e/cli.e2e.ts:209` | ✅ PASS |
| DIST-20 | 401 without/with wrong token, no work, `timingSafeEqual` | `token-guard.test.ts:252-253`, `:258-260`, `:265-266`, `:284-290`; `security.test.ts:101-102`, `:112-113`; `token.ts:11` | ✅ PASS |
| DIST-21 | Routes read from the app; 403/415/401/401; double shows no work | `security.test.ts:50-52`, `:71-83`, `:94-95`, `:101-102`, `:112-113`, `:124-125` | ✅ PASS |
| DIST-22 | Sentinel key absent from bodies, headers and CLI output | `security.test.ts:202-207`; `run.test.ts:267-269`; `e2e/cli.e2e.ts:254-257` | ✅ PASS |
| DIST-23 | Real `check` script fails on `node:child_process` (except `open-browser.ts`, `guards.test.ts`), `eval`, `new Function`, `dangerouslySetInnerHTML`; scan fails on silencers, `child_process`/`getBuiltinModule` outside `open-browser.ts` (links.ts only at the pinned lines), `__tests__` imports, gitleaks exceptions | `guards.test.ts:109-113` clean base `status toBe(0)`; `:127-132` three Biome `error` findings per workspace + `status not 0`; `:146-150` `error no-child-process: <file>` per breaker, none for the exemptions; `:217-223` silencers; `:225-237` line-pinned scan `expect(lines).toEqual([<links.ts:245>, <links.ts:252>])`; `:240-244` `__tests__` imports; `:246-249` gitleaks | ✅ PASS |
| DIST-24 | CODEOWNERS covers server guards, security suite, `.dependency-cruiser.cjs`, `biome.json`, root `package.json`, `.gitignore`, `pnpm-workspace.yaml`, `.githooks/`, `.gitleaks.toml`, `.gitleaksignore`, `CODEOWNERS` | `.github/CODEOWNERS:5-9`, `:12-17`, `:20`, `:24-26`, `:28`; owner `@Ferreira-Jefferson` = `origin` owner | ✅ PASS (file content check) |

**Status**: ✅ 24/24 ACs covered, 0 spec-precision gaps.

---

## Failure Paths

- [x] DIST-05: exact message, exit 1, zero events.
- [x] DIST-06: exact message with the port, exit 1, no browser.
- [x] DIST-20 / DIST-21: 401/403/415 asserted, work counter 0.
- [x] DIST-23 / DIST-14: each breaker must produce an `error`-severity finding and a non-zero exit; the clean base must exit 0.
- [x] Short `APP8N8_TOKEN`: exact message, exit 1, zero events (`run.test.ts:240-242`).

---

## Gate Check

- `pnpm test`: exit 0. 1640 passed, 0 failed (cli 49, server 181, web 427, python 267, typescript 233, explain 195, links 69, project 51, llm 43, model 34, input 33, testkit 29, treesitter 29). No test file was deleted in the range (`main.test.ts` was renamed to `core.test.ts`; the old `fixtures/guards` folder was replaced by breakers written at run time).
- `pnpm typecheck`: exit 0.
- `pnpm check`: exit 0. dependency-cruiser found no violations (296 modules, 796 dependencies).
- `PATH="$PATH:/c/Windows/System32:/c/Windows" pnpm e2e e2e/cli.e2e.ts`: exit 0, 7 passed (12.6s).
- Full e2e suite: not run by the Verifier. The coordinator reported 136/136 in round 4.

---

## Discrimination Sensor

Depth: P0 (security-critical). Each round used a scratch `git worktree` with its own `pnpm install --offline`. Mutants ran with vitest called directly in the package folder. After each mutant the scratch was restored with `git checkout`, and the worktree was deleted at the end of each round. Before and after every round, the real tree's `git status --porcelain` matched.

| Round | Mutants | Killed | Survived | Notes |
| ----- | ------- | ------ | -------- | ----- |
| 1 (`7c552b4`) | M1-M13 | 13 | 0 | token guard, `sameToken`, `withoutKey` and masked scrub, missing folder, short token, `--no-open`, print order, `randomBytes(16)`, `readLaunch` x2, `apiFetch` header, cruiser exemption |
| 2 (`f915e12`) | N1-N6 | 4 | 2 | N2 equivalent; N6 real (closed in d23f482) |
| 3 (`d23f482`) | N6-N9 | 2 | 2 | N9 equivalent; N8 real (closed in 398639e/6d9e807) |
| 4 (`6d9e807`) | P1-P9 | 7 | 2 | P6, P9 real (closed in 7b5bfe0) |
| 5 (`7b5bfe0`) | Q1-Q7 | 5 | 2 | Q6, Q7 outside the spec's promise (known limits below) |

Round 5 detail (guards suite baseline: 21/21 passed):

| # | File | Mutation | Result |
| - | ---- | -------- | ------ |
| Q1 | `packages/languages/typescript/src/links.ts` | P6 re-run: `process.getBuiltinModule("node:child_process").spawnSync("calc")` appended | ✅ Killed (`guards.test.ts:225`); real check alone: biome 0, depcruise 0 |
| Q2 | `links.ts` | P9 re-run: `createRequire(import.meta.url)("node:child_process")` | ✅ Killed (`:225`) |
| Q3 | `links.ts` | A copy of the allowed comparison as a comment plus `import("node:child_process")` on a new line | ✅ Killed (`:225`; depcruise also 1) |
| Q4 | `packages/server/src/token.ts` | `getBuiltinModule("node:child_process")` | ✅ Killed (`:225`) |
| Q5 | `token.ts` | An exact copy of an allowed `links.ts` line in another file | ✅ Killed (`:225`: the pin includes the file path) |
| Q6 | `links.ts` | `createRequire(import.meta.url)(lib)`, module name only known at run time | ⚪ Survived: known limit (see below) |
| Q7 | `token.ts` | `import cluster from "node:cluster"; cluster.fork()` | ⚪ Survived: known limit (see below) |

**Sensor outcome**: every mutant inside the spec's promises is killed in round 5; Q6 and Q7 are outside them.

---

## Known Limits (not gaps: the spec does not promise these)

Static checks read names in the source text. These bypasses carry no name the spec lists, so neither `pnpm check` nor the scan can see them:

1. **Run-time module names**: `createRequire(import.meta.url)(x)`, `import(x)` or `require(x)` where `x` is built at run time (`"child" + "_process"`, a variable, a value from analysed code). Proven by Q6.
2. **Other process-starting modules**: `node:cluster` (`cluster.fork()` starts a new Node process) is not on the list; DIST-23 names only `node:child_process`. Proven by Q7. Suggestion for the repository security feature: add `^(node:)?cluster$` to the `no-child-process` rule's `to.path`, which costs one line and one breaker in `guards.test.ts`.
3. **Internal bindings**: `process.binding("spawn_sync")` and `process.dlopen` (native addons) are undocumented or out-of-band routes; not probed.
4. **Shell-free paths that do not start processes but reach the network or files** are out of DIST-23's scope by design.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ |
| No scope creep | ⚠️ `APP8N8_TOKEN` env override is outside the spec; design.md:85, :181 record it (e2e and `pnpm dev` need a known token; values under 32 characters are refused) |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ |
| Per-layer coverage | ✅ unit (run, token, session, api), route-level security suite, real `check` script on breakers, e2e on the installed package |
| Every test maps to a spec requirement | ✅ |
| Documented guidelines followed | ✅ `CLAUDE.md`, `docs/portugues-tecnico-simplificado.md` |

---

## Ranked Gaps

None.

Follow-ups (optional, not blocking): known limit 2 (`node:cluster`) is a one-line hardening for the repository security feature.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| DIST-01..24 | Pending | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 24/24 ACs matched, 0 spec-precision gaps
**Sensor**: round 5: 5/5 in-scope mutants killed (Q6, Q7 are known limits); rounds 1-4 survivors all closed
**Gate**: `pnpm test` 1640 passed, `pnpm typecheck` ok, `pnpm check` ok, `e2e/cli.e2e.ts` 7 passed

**validate_state.py 07-cli**: exit 0, `validate_state: 0 error(s) across [07-cli]`.

**Lessons**: none new. The round-5 report has no failed AC, no in-scope surviving mutant and no spec-precision gap. The lessons from earlier rounds (L-018 to L-022, L-024) stay as candidates: `lessons.py` has no "addressed" command.

**Next steps**: none for this feature.
