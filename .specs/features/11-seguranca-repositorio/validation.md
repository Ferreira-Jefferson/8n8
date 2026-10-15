# Segurança do repositório Validation

**Date**: 2026-10-15 (round 5, an extra round the user authorized)
**Spec**: `.specs/features/11-seguranca-repositorio/spec.md`
**Diff range**: `119508c..2203749` (`9118e82` spec, `87fbe0b` implementation, `6f5edc3`, `2cf8621`, `a185b7e`, `2203749` fixes)
**Verifier**: independent sub-agent (author ≠ verifier)

## Validation: 11-seguranca-repositorio - PASS

All 8 ACs trace to a test that asserts the outcome the spec defines, and all gates are green. The sensor ran 28 mutants and killed every one that maps to an AC: 26 killed. Two survivors are left and both are advisory:

- **s27**: an extra step rewrites `scripts.check` before `pnpm check` runs.
- **s29**: `timeout-minutes: 0`.

Neither is a weakening that SEC-05 names. s27 belongs to an open class: an arbitrary added step can sabotage a gate, and no config test can rule out every such step. The `CODEOWNERS` review of `/.github/workflows/` covers that class once branch protection is on.

Since round 2, the workflows are checked as parsed YAML (`yaml` 2.9.1, a devDependency of `apps/cli`, published on 2026-09-11). Spelling variants no longer slip past: quoted keys, flow maps and invalid YAML were all caught (s17, s18, s20, s22, s28).

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| Implicit (medium scope, design inline) | ✅ Done | `87fbe0b`; fixes `6f5edc3`, `2cf8621`, `a185b7e`, `2203749` |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| SEC-01 | `ci.yml` on `pull_request` and `push` to `main`; install `--frozen-lockfile`, typecheck, check, test, e2e; gitleaks binary at a fixed version, checked by SHA-256 before it runs, `gitleaks git` over the whole repository | `apps/cli/src/__tests__/repo-ci.test.ts:75-81` exact `on`; `:83-91` `^\s*- run: <cmd>$` per gate; `:98-122` `jobBlock(ci,"secrets")` toEqual the exact 20 lines (checkout `fetch-depth: 0`, `GITLEAKS_VERSION: 8.30.1`, `GITLEAKS_SHA256: 551f6fc8…70eb`, curl, `sha256sum --check --strict`, tar, `./gitleaks git --redact --verbose --no-banner .`); `:233-239` parsed top keys toEqual `["name","on","permissions","jobs"]`; `:241-256` no job `if`/`continue-on-error`/`defaults`/`env`, no step `if`/`continue-on-error`/`shell`, no run with `\|\| true`, `\|\| :`, `exit 0`; `:273-285` env only on the gitleaks step with exactly the two keys. Config: `.github/workflows/ci.yml:4-51` | ✅ PASS |
| SEC-02 | top `permissions: contents: read`; no `pull_request_target`; each action pinned by a 40-char SHA | `repo-ci.test.ts:35-41` `/@[0-9a-f]{40}$/`; `:43-45`, `:233-239` `doc.permissions` toEqual `{contents:"read"}`; `:67-69` | ✅ PASS |
| SEC-03 | CodeQL JS/TS on PR, push to `main`, weekly; `security-events: write` only in the analysis job | `repo-ci.test.ts:155-165` exact `on` incl. `branches: [main]` and `- cron: "17 6 * * 1"`; `:167-173`; `:258-271` only `codeql.yml` `analyze` has permissions, exactly `{contents:"read","security-events":"write"}` | ✅ PASS |
| SEC-04 | weekly `npm` at `/` and `github-actions` | `repo-ci.test.ts:175-185`; `.github/dependabot.yml:4-14` | ✅ PASS |
| SEC-05 | The test fails on a lost gate, an unpinned action, a top permission, `pull_request_target`, an `if:`, a `continue-on-error`, or no full history in the gitleaks job | `repo-ci.test.ts:35-45`, `:67-69`, `:83-91`, `:93-96`, `:98-122`, `:233-271`; every enumerated mutant killed (table below) | ✅ PASS |
| SEC-06 | `SECURITY.md` in PTS: private reporting, what counts, supported version, branch protection steps | `repo-ci.test.ts:188-205` 11 markers (`Report a vulnerability`, `chave`, `Claude Code`, `porta`, `no-child-process`, `fora da pasta analisada`, `## Versão suportada`, `exija pull request`, `status checks`, `CODEOWNERS`, `force push`); `SECURITY.md:5-42` | ✅ PASS |
| SEC-07 | `CODEOWNERS` covers workflows, dependabot, `SECURITY.md` | `repo-ci.test.ts:207-218` `^<path> @Ferreira-Jefferson$`; `.github/CODEOWNERS:35-37` | ✅ PASS |
| SEC-08 | `no-child-process` refuses `node:cluster`, same exceptions, proven by a violating file | `.dependency-cruiser.cjs:144-147` `^(node:)?(child_process\|cluster)$`; `apps/cli/src/__tests__/guards.test.ts:151-154` probes, `:158-163` `toContain("error no-child-process: <file>")`, exceptions absent | ✅ PASS |

**Status**: ✅ All ACs covered

---

## Pins and binary

These were checked in rounds 1 and 2. They have not changed since.

- The five action SHAs equal the commits of their tags (`git ls-remote`, peeled `^{}` for the annotated tags). All are more than 14 days old.
- The gitleaks 8.30.1 linux_x64 SHA-256 is `551f6fc8…70eb`. That matches the release checksums file and a fresh download, and the archive has `gitleaks` at its root.
- A local full-history scan with the same release covered 370 commits, used `.gitleaks.toml` and found no leaks.

New in this round:

- `yaml` 2.9.1 was published on 2026-09-11 (more than 14 days ago) and is the npm `latest` tag.
- `pnpm install --frozen-lockfile --offline` passes with the updated `pnpm-lock.yaml`.

---

## CI correctness (static, carried over)

- `pnpm/action-setup` reads `packageManager` (`pnpm@12.6.0`).
- `cache: pnpm` comes after pnpm is installed.
- `on:` is fine for GitHub.
- The gitleaks CLI needs no license and no pulls API.
- `pnpm e2e` on ubuntu is likely to work:
  - there are no screenshot baselines;
  - `npm install -g --offline` works because `@8n8/cli` has no runtime dependencies;
  - on Linux `child.kill()` is used, and `taskkill` runs only on Windows.
- **Residual risk:** the `skipIf(win32)` tests and the E2E suite have never run on Linux. The first CI run is their first run.

---

## Discrimination Sensor

Scratch: a detached `git worktree` of `2203749` with its own `pnpm install --offline`. For each mutant I ran `vitest run` on the covering file and then restored the tree with `git checkout`.

| Mutation | File | Description | Killed? |
| -------- | ---- | ----------- | ------- |
| m1 | `ci.yml:18` | checkout `@v7` | ✅ |
| m2a | `ci.yml:10` | top `write-all` | ✅ |
| m3 | `ci.yml:5` | `pull_request_target` | ✅ |
| m4 | `ci.yml:28` | `pnpm check` dropped | ✅ |
| m5b | `ci.yml:39` | `fetch-depth: 0` moved to `gates` | ✅ |
| m6 | `codeql.yml` | `security-events: write` at the top | ✅ |
| m7 | `dependabot.yml` | `github-actions` removed | ✅ |
| m8 | `CODEOWNERS:35` | workflows line removed | ✅ |
| m9 | `.dependency-cruiser.cjs:146` | `cluster` dropped (`guards.test.ts`) | ✅ |
| m10b | `SECURITY.md` | supported-version section removed | ✅ |
| x1 / x2 / x4 | `ci.yml` | step `if: false` / job `continue-on-error` / job `write-all` | ✅ / ✅ / ✅ |
| s1 / s2 | `ci.yml:49`, `:51` | `\|\| true` on the checksum / `exit 0` before the scan | ✅ / ✅ |
| s16 / s17 | `ci.yml:12` | top `defaults` shell `bash +e` / same with a quoted key | ✅ / ✅ |
| s18 | `ci.yml:12` | top `'env':` (quoted) | ✅ |
| s20 | `ci.yml:30` | `\|\| :` unquoted, which is invalid YAML (`YAMLParseError`, suite exit 1) | ✅ |
| s20b | `ci.yml:30` | `"… \|\| :"` quoted | ✅ |
| s22 | `ci.yml` | job `"if": false` | ✅ |
| s23 | `ci.yml:29` | step `shell: bash +e {0}` | ✅ |
| s24 | `ci.yml:30` | `; exit   0` (several spaces) | ✅ |
| s25 | `codeql.yml` | job-level `env` | ✅ |
| s26 | `codeql.yml:21` | extra `actions: write` | ✅ |
| s28 | `ci.yml` | flow-map job with `if: false` | ✅ |
| s27 | `ci.yml:26` | extra step `npm pkg set scripts.check=true` | ⚠️ Survived (advisory) |
| s29 | `ci.yml:16` | `timeout-minutes: 0` | ⚠️ Survived (advisory: not a gate bypass; at worst the job ends early and fails or is cancelled) |

**Sensor depth**: P0-full
**Result**: 26 of 28 killed. Every AC-mapped mutant is killed. PASS ✅
**Isolation**: the real tree's `git status --porcelain` matched the pre-sensor baseline. The worktree was removed and pruned.

### Advisories (do not block)

- **s27, sabotage by an added step.** Any extra step can change what a later gate runs. Two things would narrow this, and both are optional:
  - pin the `gates` job's step list exactly, as the `secrets` job already is;
  - add `/apps/cli/src/__tests__/repo-ci.test.ts` to `.github/CODEOWNERS`, next to `guards.test.ts` (`.github/CODEOWNERS:19`).

  A PR can edit the test together with the workflow. The workflow is already owner-reviewed, but the test is not.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ (one devDependency, `yaml`, pinned; the parsed checks replace nothing, they add to the text checks) |
| Surgical changes | ✅ |
| No scope creep | ✅ |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ |
| Every test maps to a spec requirement | ✅ (each `describe` names its SEC ids) |
| Documented guidelines followed: `CLAUDE.md`, `CONTRIBUTING.md` | ✅ |

---

## Failure Paths

- [x] SEC-05: every enumerated weakening fails with the offending key or value, whether it is written plainly, quoted or as a flow map. Invalid YAML fails the suite at load.
- [x] SEC-01: a non-blocking checksum (`|| true`, a top-level or step `shell` without `-e`), an early `exit 0` or a swapped config env all fail.

---

## Gate Check

- **Gate commands**: `pnpm typecheck`, `pnpm check`, `pnpm test`, plus `pnpm install --frozen-lockfile --offline`
- **Result**:
  - typecheck exit 0.
  - check exit 0: dependency-cruiser "no dependency violations found" over 333 modules.
  - test exit 0: 1931 passed, 0 failed, 3 skipped.
  - frozen install exit 0.
- **Delta**: 1918 in round 1 → 1931 now. `repo-ci.test.ts` has 32 tests.
- **Skipped tests**:
  - the `skipIf(win32)` cases at `apps/cli/src/__tests__/run.test.ts:286` and `packages/server/src/__tests__/settings-file.test.ts:67`;
  - the opt-in smoke test at `packages/llm/src/__tests__/claude-code.test.ts:372`.
- **E2E**: not run. No E2E surface changed.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| SEC-01 | ❌ Needs Fix | ✅ Verified |
| SEC-02 | ✅ Verified | ✅ Verified |
| SEC-03 | ✅ Verified | ✅ Verified |
| SEC-04 | ✅ Verified | ✅ Verified |
| SEC-05 | ✅ Verified | ✅ Verified |
| SEC-06 | ✅ Verified | ✅ Verified |
| SEC-07 | ✅ Verified | ✅ Verified |
| SEC-08 | ✅ Verified | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 8 of 8 ACs met
**Sensor**: 26 of 28 killed. All AC-mapped mutants are killed; 2 survivors are advisory.
**Gate**: 1931 passed; typecheck, check and frozen install green

**What works**:
- the CI runs every gate;
- gitleaks scans the whole history with a binary checked by its SHA-256;
- every action is SHA-pinned;
- permissions are read-only, except CodeQL's `security-events: write` in its own job;
- CodeQL, Dependabot, `SECURITY.md` and CODEOWNERS are in place;
- the `cluster` guard holds;
- the config test checks both the text and the parsed YAML.

**Next steps**: the external steps in `SECURITY.md` (push, branch protection, private vulnerability reporting, Dependabot, secret scanning) stay with the project owner. The first CI run on GitHub is the real proof of the Linux run. The s27 advisory is optional.
