# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

### L-003 - State how a classification table entry matches (whole segment or substring, and which receiver shapes) when the spec lists text fragments like .execute(.
- signal: `spec_precision_gap` · recurrence: 2 feature(s) · scope: `extract-python` · harmful: 0
- features: 01-fatia-central, 04-fidelidade-e-cache
- evidence: CORE-12 SP-2 (extract-python) (+1 more)
- last seen: 2026-10-13T21:41:18Z

## Candidates (under observation - do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 - Classify an external call by its final attribute even when the receiver is a call or subscript, not only when the callee is a plain dotted name.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 01-fatia-central
- evidence: CORE-12 / packages/extract-python/src/calls.ts:19 (extract-python)
- last seen: 2026-10-13T17:30:04Z

### L-002 - Cover each CPython syntax-error class with a fixture, including empty indented blocks that tree-sitter recovers without ERROR or MISSING nodes.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 01-fatia-central
- evidence: CORE-06 / packages/extract-python/src/errors.ts:27 (extract-python)
- last seen: 2026-10-13T17:30:04Z

### L-004 - Put every input sent to the LLM into the explanation cache key, or state in the spec which inputs are deliberately left out.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `explain` · harmful: 0
- features: 01-fatia-central
- evidence: CORE-17 x CORE-18 SP-3 / packages/explain/src/explain.ts:53 (explain)
- last seen: 2026-10-13T17:30:04Z

### L-005 - Validate LLM suggestion lines as plain integers and filter the range afterwards, so one bad line drops a suggestion instead of the whole answer.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `explain` · harmful: 0
- features: 01-fatia-central
- evidence: SPEC_DEVIATION packages/explain/src/schema.ts:14 (explain)
- last seen: 2026-10-13T17:30:04Z

### L-006 - Compare tree-sitter error recovery against CPython for every syntax-error class before relying on ERROR and MISSING nodes alone.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 01-fatia-central
- evidence: SPEC_DEVIATION packages/extract-python/src/errors.ts:23 (extract-python)
- last seen: 2026-10-13T17:30:04Z

### L-007 - State in the spec whether a reported error line is the interpreter's line or a line inside the marked node, since the two differ for errors reported after a header.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 01-fatia-central
- evidence: SP-5 / CORE-06 / packages/extract-python/src/errors.ts:40 (extract-python)
- last seen: 2026-10-13T17:40:16Z

### L-008 - Pin token matching with a case where the searched fragment appears in the code only inside a longer identifier, so a substring check fails the test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `explain` · harmful: 0
- features: 04-fidelidade-e-cache
- evidence: M4b / FID-03 / packages/explain/src/checks.ts:89 (explain)
- last seen: 2026-10-13T21:41:17Z

### L-009 - When a cache changes its file layout, state in the spec what happens to entries written under the old layout, not only how an unreadable entry is treated.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `explain` · harmful: 0
- features: 04-fidelidade-e-cache
- evidence: SP-2 / CACHE-07 / packages/explain/src/cache.ts:64 (explain)
- last seen: 2026-10-13T21:41:19Z

### L-010 - Test every entry of a spec-listed exclusion set, not a sample, so that dropping any one entry fails a test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `input` · harmful: 0
- features: 02-pasta-local
- evidence: M1a/M1b/M1d / PROJ-01 / packages/input/src/read-folder.ts:7 (input)
- last seen: 2026-10-13T23:06:55Z

### L-011 - Test a content-type guard with every CORS-simple type, and check that a no-header test really sends none, since fetch adds text/plain to a string body.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `server` · harmful: 0
- features: 02-pasta-local
- evidence: M11 / AD-016 / packages/server/src/app.ts:52 (server)
- last seen: 2026-10-13T23:06:55Z

### L-012 - Pin a path-based cache identity with a typed path that differs from the canonical one in case, separators or trailing slash.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `server` · harmful: 0
- features: 02-pasta-local
- evidence: M13 / CACHE-06 / packages/server/src/app.ts:111 (server)
- last seen: 2026-10-13T23:06:56Z

### L-013 - State in the spec how a dotted call to a project module that was never imported is classified, not only a bare name.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 02-pasta-local
- evidence: SP-3 / PROJ-09 / packages/extract-python/src/calls.ts:61 (extract-python)
- last seen: 2026-10-13T23:06:56Z

### L-014 - State size limits in the spec as an exact byte count, since 1 MB can mean 1 000 000 or 1 048 576.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `input` · harmful: 0
- features: 02-pasta-local
- evidence: SP-1 / PROJ-06 / packages/input/src/read-file.ts:4 (input)
- last seen: 2026-10-13T23:06:56Z

### L-015 - Pin a file-extension filter with near-miss names such as .pyc and .pyi, so a substring match fails a test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `input` · harmful: 0
- features: 02-pasta-local
- evidence: N13 / PROJ-01 / packages/input/src/read-folder.ts:56 (input)
- last seen: 2026-10-13T23:48:09Z

### L-016 - Test each name-resolution fallback in every function that resolves names, not only in the first one that uses it.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 02-pasta-local
- evidence: N10 / PROJ-03 / packages/extract-python/src/project.ts:162 (extract-python)
- last seen: 2026-10-13T23:48:15Z

### L-017 - When the design names a parsing risk, test its fix in every code path that parses that construct, not only one.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 02-pasta-local
- evidence: N12 / PROJ-03 / packages/extract-python/src/project.ts:146 (extract-python)
- last seen: 2026-10-13T23:48:15Z

### L-018 - When the design grants an exception to a spec prohibition, amend the spec AC in the same change, and make the check scan every folder the prohibition names.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `build-guards` · harmful: 0
- features: 07-cli
- evidence: DIST-23 / .dependency-cruiser.cjs:136 / apps/cli/src/__tests__/guards.test.ts:107 (build-guards)
- last seen: 2026-10-15T02:21:29Z

### L-019 - Give a keep-working-as-before requirement one observable outcome and a test, such as a value read from .env that shows up in the output.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `dev-scripts` · harmful: 0
- features: 07-cli
- evidence: DIST-15 / package.json:16,18 (dev-scripts)
- last seen: 2026-10-15T02:21:29Z

### L-020 - Give every branch of an import-boundary AC its own violating fixture, not only some of the importers it names.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `build-guards` · harmful: 0
- features: 07-cli
- evidence: DIST-14 / apps/cli/src/__tests__/guards.test.ts:113 (build-guards)
- last seen: 2026-10-15T02:21:29Z

### L-021 - Pin a rule exemption to its one file with a fixture of a sibling file that the rule must still reject, so widening the exemption fails a test.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `build-guards` · harmful: 0
- features: 07-cli
- evidence: N6 / DIST-23 / .dependency-cruiser.cjs:136 (build-guards)
- last seen: 2026-10-15T02:27:28Z

### L-022 - When a test proves a lint or boundary rule fails the build, assert the violation has the severity that makes the command exit non-zero, not only that it is reported.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `build-guards` · harmful: 0
- features: 07-cli
- evidence: N8 / DIST-23 / apps/cli/src/__tests__/guards.test.ts:28 (build-guards)
- last seen: 2026-10-15T02:31:37Z

### L-023 - Teste uma guarda de build pela propriedade: rode o script real (pnpm check) com a config real sobre um arquivo que viola uma regra por vez, confira a falha e a gravidade, e varra o código pelo que a ferramenta não vê; ler valores da config não conta como teste.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `build-guards` · harmful: 0
- features: 07-cli
- evidence: N6,N8,M1-M16 (guards.test.ts) (build-guards)
- last seen: 2026-10-15T02:55:49Z

### L-024 - Scope a source-scan allowance to the exact text a file needs, never to the whole file, and scan for the loading mechanisms (getBuiltinModule, createRequire) as well as the module name.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `build-guards` · harmful: 0
- features: 07-cli
- evidence: P6, P9 / DIST-23 / apps/cli/src/__tests__/guards.test.ts:228-231 (build-guards)
- last seen: 2026-10-15T03:00:30Z

### L-025 - On Windows, retry fs.rename over an existing file on EPERM/EACCES/EBUSY with a short backoff; a just-written target can be briefly locked by antivirus or the indexer.
- signal: `gate_fail` · recurrence: 1 feature(s) · scope: `fs-windows` · harmful: 0
- features: 08-config-llm-sob-demanda
- evidence: packages/server/src/settings-file.ts:272 (fs-windows)
- last seen: 2026-10-15T04:26:42Z

### L-026 - When a spec promises an atomic write (temp file + rename), test the mechanism itself: spy the fs calls or fail mid-write and assert the old file is intact.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `fs` · harmful: 0
- features: 08-config-llm-sob-demanda
- evidence: M15 settings-file.ts:267 (fs)
- last seen: 2026-10-15T04:26:42Z

### L-027 - When validation lives in a service, still add a route test asserting the exact HTTP status the spec names; a client that treats every non-ok alike hides a wrong status.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `server-routes` · harmful: 0
- features: 08-config-llm-sob-demanda
- evidence: M22 CFG-14 app.ts PUT /api/settings (server-routes)
- last seen: 2026-10-15T04:26:42Z

### L-028 - For a notice tied to a server state, say in the AC when it appears (on selection or after the click) when a cache-only request can answer before that state is known.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `web-panel` · harmful: 0
- features: 08-config-llm-sob-demanda
- evidence: CFG-09 (web-panel)
- last seen: 2026-10-15T04:26:42Z

### L-029 - In a failure path that handles a secret, log only the error code, never err.message, and cover the log with the same sentinel check used for responses.
- signal: `ac_gap` · recurrence: 1 feature(s) · scope: `server-secrets` · harmful: 0
- features: 08-config-llm-sob-demanda
- evidence: packages/server/src/app.ts PUT /api/settings 500 log (CFG-23, dba6920) (server-secrets)
- last seen: 2026-10-15T04:36:50Z

### L-030 - A no-leak assertion (not.toContain) only discriminates when every failure fixture actually carries the sentinel it checks for.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `llm-provider` · harmful: 0
- features: 09-provedor-claude-code
- evidence: M13 packages/llm/src/__tests__/claude-code.test.ts:248 (llm-provider)
- last seen: 2026-10-15T04:56:18Z

### L-031 - When security options live in an injected-deps default (REAL spawn, workDir), test that default adapter too, e.g. by mocking the node module, not only the fake deps.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `llm-provider` · harmful: 0
- features: 09-provedor-claude-code
- evidence: M4,M15 packages/llm/src/claude-code.ts:43 (llm-provider)
- last seen: 2026-10-15T04:56:19Z

### L-032 - Timeout tests must bound when the timer fires (fake timers or elapsed check); a generous testTimeout hides a wrong unit.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `llm-provider` · harmful: 0
- features: 09-provedor-claude-code
- evidence: M11 packages/llm/src/__tests__/claude-code.test.ts:299 (llm-provider)
- last seen: 2026-10-15T04:56:19Z

### L-033 - When the implementation adds a lookup location or makes an argument conditional, amend the AC in the same task instead of leaving the spec behind.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `spec` · harmful: 0
- features: 09-provedor-claude-code
- evidence: CC-02 packages/llm/src/claude-code.ts:89; CC-03 claude-code.ts:131 (spec)
- last seen: 2026-10-15T04:56:19Z

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
