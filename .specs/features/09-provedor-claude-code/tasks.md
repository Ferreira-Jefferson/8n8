# Provedor Claude Code Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: inline (escopo médio). O provedor é um arquivo em `packages/llm`, como os outros (AD-021). `LlmProvider.isConfigured` e `create` passam a receber `options.env` (o ambiente do host, que o núcleo já recebe em `CoreOptions.env`) e `options.spawn` (injetável nos testes). O serviço de config passa o `env` ao criar o cliente. `SettingsResponse.providers` ganha `usesKey`, e o diálogo esconde chave e URL quando ele é falso.
**Status**: Done

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Provedor (`packages/llm`) | unit (Vitest, `spawn` falso) | Argumentos, stdin, pasta, ambiente, saídas, erros, tempo, tamanho, busca do executável | `packages/llm/src/__tests__/claude-code.test.ts` | `pnpm --filter @8n8/llm test` |
| Núcleo (`packages/server`) | unit | `env` chega ao provedor; `usesKey` na vista | `packages/server/src/__tests__/settings.test.ts` | `pnpm --filter @8n8/server test` |
| Guardas (`apps/cli`) | unit | Exceção nomeada, outro arquivo de `llm` falha | `apps/cli/src/__tests__/guards.test.ts` | `pnpm --filter @8n8/cli test` |
| Tela (`apps/ui`) | unit | Diálogo sem chave e URL para `claude-code` | `apps/ui/src/settings/__tests__/*.test.tsx` | `pnpm --filter @8n8/ui test` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm --filter <pacote> test && pnpm typecheck` |
| Build | After the last task | `pnpm typecheck && pnpm check && pnpm test && pnpm e2e` |

---

## Execution Plan

```
T1 → T2 → T3 → T4
```

---

## Task Breakdown

### T1: Provedor `claude-code`

**What**: `packages/llm/src/claude-code.ts` com `locateClaude(env, fs)` e o cliente que roda o executável; registro em `PROVIDERS`; `options.env` e `options.spawn` no contrato do provedor.
**Where**: `packages/llm/src/claude-code.ts`
**Depends on**: None
**Reuses**: `LlmProvider`, `createLlmClient`
**Requirement**: CC-01, CC-02, CC-03, CC-04, CC-05, CC-06, CC-07, CC-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Testes com `spawn` falso para cada AC de CC-02 a CC-08
- [x] Teste real opcional com `APP8N8_CLAUDE_SMOKE=1`
- [x] Gate check passes: `pnpm --filter @8n8/llm test`
- [x] Desvio: `pnpm check` fica vermelho até a T3, que nomeia o arquivo como exceção da regra `no-child-process`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(llm): add the claude code provider`

---

### T2: Ambiente do host e `usesKey` no núcleo

**What**: O serviço de config passa `{ env }` ao `createLlmClient`; a vista ganha `usesKey` por provedor.
**Where**: `packages/server/src/settings.ts`
**Depends on**: T1
**Reuses**: `createSettingsService`
**Requirement**: CC-01, CC-02, CC-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Sem executável, `claude-code` responde `no-key`; com `APP8N8_CLAUDE_PATH`, monta o cliente
- [x] Gate check passes: `pnpm --filter @8n8/server test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): pass the host environment to the llm providers`

---

### T3: Guardas da segunda exceção

**What**: Exceção nomeada na regra `no-child-process`, varredura e casos do teste das guardas, CODEOWNERS, DIST-23 da 07.
**Where**: `.dependency-cruiser.cjs`
**Depends on**: T2
**Reuses**: `guards.test.ts`
**Requirement**: CC-09, CC-10, CC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `packages/llm/src/other.ts` com `node:child_process` falha o check; `claude-code.ts` passa
- [x] Gate check passes: `pnpm --filter @8n8/cli test && pnpm check`

**Tests**: unit
**Gate**: quick

**Commit**: `build: allow only the claude code provider to start processes in llm`

---

### T4: Diálogo e documentação

**What**: O diálogo esconde chave e URL de um provedor sem chave e mostra o aviso do CC-01; README, guia de provedor e STATE.
**Where**: `apps/ui/src/settings/SettingsDialog.tsx`
**Depends on**: T3
**Reuses**: `SettingsDialog`
**Requirement**: CC-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Teste do diálogo com `claude-code`
- [x] Gate check passes: `pnpm typecheck && pnpm check && pnpm test && pnpm e2e`

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): show the claude code provider without key fields`

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | início | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Provedor | unit | unit | ✅ OK |
| T2 | Núcleo | unit | unit | ✅ OK |
| T3 | Guardas | unit | unit | ✅ OK |
| T4 | Tela | unit | unit | ✅ OK |
