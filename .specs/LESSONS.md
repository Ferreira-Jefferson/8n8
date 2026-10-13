# LESSONS - auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

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

### L-003 - State how a classification table entry matches (whole segment or substring, and which receiver shapes) when the spec lists text fragments like .execute(.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `extract-python` · harmful: 0
- features: 01-fatia-central
- evidence: CORE-12 SP-2 (extract-python)
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

## Quarantined (failed when applied - ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
