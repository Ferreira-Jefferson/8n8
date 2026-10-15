# Provedor Claude Code Validation

**Date**: 2026-10-15
**Spec**: `.specs/features/09-provedor-claude-code/spec.md`
**Diff range**: `5fce8bb..7c3e316` (rodada 2; a rodada 1 cobriu `5fce8bb..cc36ee5`)
**Verifier**: independent sub-agent (author ≠ verifier)

**Verdict**: PASS ✅

Os 12 ACs têm prova que discrimina. Os 27 mutantes, 25 deles de segurança, morreram. O commit `7c3e316` fechou as 5 lacunas da rodada 1 (M4, M11, M13, M15 e a spec atrás do código) e acrescentou a regra do modelo.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | `8500e5b` |
| T2 | ✅ Done | `9207f78` |
| T3 | ✅ Done | `834cbcd` |
| T4 | ✅ Done | `cc36ee5` |
| Fix (rodada 1) | ✅ Done | `7c3e316` |

---

## Spec-Anchored Acceptance Criteria

| AC | Spec-defined outcome | `file:line` + assertion | Result |
| -- | -------------------- | ----------------------- | ------ |
| CC-01 | `claude-code` com padrão `sonnet`; o diálogo lista; sem chave e URL; aviso exato | `packages/llm/src/__tests__/claude-code.test.ts:109-111` - `defaultModel` `"sonnet"`, `usesKey` `false`; `packages/llm/src/__tests__/providers.test.ts:16-20` - ids; `packages/server/src/__tests__/settings.test.ts:52` - `{ id: "claude-code", defaultModel: "sonnet", usesKey: false }`; `apps/web/src/settings/__tests__/SettingsDialog.test.tsx:204-208` - `queryByLabelText("Chave de API")`/`("URL")` nulos, aviso exato; `e2e/configuracoes.e2e.ts:214-234` - na tela real, `selectOption("claude-code")`, campos com `toHaveCount(0)`, aviso visível, `config.json` com `provider: "claude-code"` | ✅ PASS |
| CC-02 | `APP8N8_CLAUDE_PATH` → APPDATA npm → `~\.local\bin\claude.exe` (Windows); `PATH` → `~/.local/bin` → `~/.claude/local` (fora); nada → `no-key` | `claude-code.test.ts:128-139` - caminho fixo inválido dá `toBeUndefined()` mesmo com o do APPDATA presente; `:141-157`, `:159-164`, `:166-184`; `:345-348` e `settings.test.ts` (bloco CC-01/02/12) - `client` `toBeUndefined()` | ✅ PASS |
| CC-03 | Sem shell, argumentos exatos, `--system-prompt` só com mensagem de sistema, conversa pelo stdin, nunca `--bare`; modelo com `-` falha; `PUT` só aceita id | `claude-code.test.ts:194-212` - lista exata, `shell` `false`, sem `--bare`; `:218-219` - stdin exato; `:342-344` - `claudeArgs("--bare", "S")` lança "Modelo inválido para o Claude Code."; `packages/llm/src/__tests__/claude-code-real.test.ts:66` - adaptador real com `shell` `false`; `settings.test.ts:174-177` - `--dangerously-skip-permissions` e `sonnet --bare` recusados; `:199-210` - ids válidos aceitos | ✅ PASS |
| CC-04 | `cwd` = `<tmp>/8n8-claude`, criada se falta, nunca a pasta analisada | `claude-code.test.ts:225` (deps falsas); `claude-code-real.test.ts:69-71` - `cwd` `toBe(join(tmpdir(), "8n8-claude"))`, `not.toBe(process.cwd())`, `existsSync(workDir)` | ✅ PASS |
| CC-05 | Ambiente sem `OPENROUTER_API_KEY` e `APP8N8_LLM_API_KEY` | `claude-code.test.ts:237-239` - chaves exatas do filho, com a chave em minúsculas | ✅ PASS |
| CC-06 | `result` no sucesso; 3 mensagens curtas, sem saída bruta | `claude-code.test.ts:244`; `:247-287` - mensagens exatas e `not.toContain("def f()")`, agora com `def f()` no stdout e no stderr do caso de código 1 (`:249`) | ✅ PASS |
| CC-07 | 180 s / 5 MB; mata o processo; mensagens exatas | `claude-code.test.ts:299-311` - `killed` `true`, mensagens, rejeição em menos de 1 s (`:306`); `:313-318` - `LIMITS` | ✅ PASS |
| CC-08 | Ordem; "Sua resposta anterior:" e "Pedido:" | `claude-code.test.ts:326-336` - texto exato | ✅ PASS |
| CC-09 | 2ª exceção; outro arquivo de `packages/llm` falha o check | `.dependency-cruiser.cjs:139`; `apps/cli/src/__tests__/guards.test.ts:110-114`, `:137-154` | ✅ PASS |
| CC-10 | Varredura aceita `child_process` só em `claude-code.ts` | `guards.test.ts:228-240` | ✅ PASS |
| CC-11 | CODEOWNERS para `claude-code.ts` | `.github/CODEOWNERS:13` (inspeção) | ✅ PASS |
| CC-12 | `PUT /api/settings` sem campo de caminho | `settings.test.ts` bloco "refuses a path to the executable through a patch" - 3 nomes `rejects.toBeInstanceOf(InvalidSettings)`, `writes` vazio | ✅ PASS |

**Status**: ✅ All ACs covered

---

## Failure Paths

- [x] CC-02: sem executável → `client` indefinido → `no-key`.
- [x] CC-03: modelo com `-` → erro exato; `PUT` com modelo inválido → `InvalidSettings`, nada gravado.
- [x] CC-06: código ≠ 0, JSON inválido, sem `result`, `is_error` → mensagens exatas, sem a sentinela.
- [x] CC-07: tempo e tamanho → mensagens exatas, `kill()`, tempo limitado.

---

## Discrimination Sensor

Worktree isolado em `7c3e316` (`git worktree add --detach`, `pnpm install --offline` próprio, sem link para o `node_modules` do repositório). Cada mutante foi aplicado, testado e revertido.

| # | File | Mutation | Killed? |
| - | ---- | -------- | ------- |
| M1 | `packages/llm/src/claude-code.ts` | `shell: true` | ✅ |
| M2 | `claude-code.ts` | conversa como argumento, stdin vazio | ✅ |
| M3 | `claude-code.ts` | `cwd: process.cwd()` | ✅ |
| M4 | `claude-code.ts` | `REAL.workDir` devolve `process.cwd()` | ✅ (sobreviveu na rodada 1) |
| M5 | `claude-code.ts` | sem `--setting-sources user` | ✅ |
| M6 | `claude-code.ts` | `user,project,local` | ✅ |
| M7 | `claude-code.ts` | sem `--tools ""` | ✅ |
| M8 | `claude-code.ts` | `--bare` acrescentado | ✅ |
| M9 | `claude-code.ts` | ambiente inteiro ao filho | ✅ |
| M10 | `claude-code.ts` | filtro de chaves sensível à caixa | ✅ |
| M11 | `claude-code.ts` | timer × 1000 | ✅ (sobreviveu na rodada 1) |
| M12 | `claude-code.ts` | sem limite de saída | ✅ |
| M13 | `claude-code.ts` | stdout bruto no erro de código ≠ 0 | ✅ (sobreviveu na rodada 1) |
| M14 | `claude-code.ts` | `APP8N8_CLAUDE_PATH` inválido cai nos outros lugares | ✅ |
| M15 | `claude-code.ts` | `REAL.spawn` com `shell: true` | ✅ (sobreviveu na rodada 1) |
| M16 | `claude-code.ts` | sem `child.kill()` | ✅ |
| M17 | `claude-code.ts` | ignora `is_error` | ✅ |
| M18 | `claude-code.ts` | limite de 50 MB | ✅ |
| M19 | `claude-code.ts` | subtipo inválido ecoado | ✅ |
| M20 | `packages/server/src/settings.ts` | `env` do host não chega ao provedor | ✅ |
| M21 | `apps/web/src/settings/SettingsDialog.tsx` | esconde pelo provedor salvo | ✅ |
| M22 | `SettingsDialog.tsx` | `usesKey` padrão invertido | ✅ |
| M23 | `.dependency-cruiser.cjs` | exceção ampliada para `^packages/llm/` | ✅ |
| M24 | `claude-code.ts` | timer nunca dispara | ✅ |
| M25 | `claude-code.ts` | uma mensagem vai marcada | ✅ |
| M26 | `claude-code.ts:126` | sem a recusa do modelo com `-` | ✅ |
| M27 | `packages/server/src/settings.ts:82` | regex do modelo aceita `-` no início | ✅ |

**Sensor depth**: P0 (processo externo), 27 mutantes manuais.
**Result**: 27/27 killed - PASS ✅
**Isolamento**: `git status --porcelain` igual antes e depois; worktree removido, `git worktree list` só mostra o principal.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ |
| Surgical changes | ✅ |
| No scope creep | ✅ |
| Matches patterns | ✅ |
| Spec-anchored outcome check | ✅ |
| Per-layer Coverage Expectation | ✅ (provedor, núcleo, guardas, tela e e2e) |
| Every test maps to a spec requirement | ✅ |
| Documented guidelines followed: `CLAUDE.md` | ✅ |

---

## Gate Check

- `pnpm test`: exit 0. 1833 passed, 0 failed, 3 skipped (um em `llm`, o smoke opt-in; um em `server`; um em `cli`).
- **Test count**: 1824 na rodada 1, 1833 agora (+9).
- `pnpm typecheck`: exit 0.
- `pnpm check`: exit 0 (309 módulos, sem violações).
- `pnpm --filter @8n8/cli build`: exit 0.
- `pnpm exec playwright test e2e/configuracoes.e2e.ts`: 6/6 passed.
- O smoke real passou na rodada 1 (26/26, `haiku`). Ele não rodou de novo nesta rodada: a mudança dele é só a pasta afirmada, e o teste com `node:child_process` falso cobre essa pasta.
- O Verifier não rodou a suíte e2e inteira.

---

## Observações (não bloqueiam)

- O teste da recusa do modelo chama só `claudeArgs` (`claude-code.test.ts:342`). O código lança antes do `spawn` (`claude-code.ts:126`, chamado em `runClaude` antes de `deps.spawn`), mas nenhum teste afirma que nenhum processo foi iniciado. Um caso via `complete()` com `runs` vazio fecharia isso.
- A regex do `PUT` (`settings.ts:82`) recusa colchetes. Se o Claude Code aceitar aliases como `opus[1m]`, eles não podem ser escolhidos pela tela, só pelo `APP8N8_MODEL`. Não verifiquei se esse alias existe.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| CC-01..12 | Pending (rodada 1: CC-03, CC-04, CC-06 Needs Fix) | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 12/12 ACs com prova que discrimina.
**Sensor**: 27/27 mutantes mortos.
**Gate**: 1833 unitários, typecheck, check, build e 6 e2e verdes.
