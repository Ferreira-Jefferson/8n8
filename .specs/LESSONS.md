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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
