# Extensão VS Code Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/10-extensao-vscode/design.md`
**Status**: In Progress

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Tela (`apps/web`) | unit (Vitest) | Transporte da ponte, pasta da meta, aviso ready | `apps/web/src/__tests__/*.test.ts` | `pnpm --filter @8n8/web test` |
| Extensão: módulos puros (`apps/vscode`) | unit (Vitest) | Cada regra da ponte, CSP, store, build | `apps/vscode/src/__tests__/*.test.ts` | `pnpm --filter @8n8/vscode test` |
| Extensão no VS Code real | integration (`@vscode/test-electron`) | Comando, painel, ready, `POST /api/project` 200 | `apps/vscode/src/test/*.ts` | `pnpm --filter @8n8/vscode test:integration` |
| Guardas | unit | Regras novas com arquivo que viola | `apps/cli/src/__tests__/guards.test.ts` | `pnpm --filter @8n8/cli test` |
| Docs | none | - | - | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm --filter <pacote> test && pnpm typecheck` |
| Build | After the last task | `pnpm typecheck && pnpm check && pnpm test && pnpm e2e && pnpm --filter @8n8/vscode test:integration` |

---

## Execution Plan

### Phase 1: Tela pronta para a webview

```
T1
```

### Phase 2: Pacote da extensão

```
T2 → T3 → T4 → T5 → T6
```

### Phase 3: Guardas e documentação

```
T7 → T8
```

---

## Task Breakdown

### T1: Tela com ponte e caminhos relativos

**What**: `base: "./"` no Vite; `apiFetch` com o transporte da webview; `readLaunch` com a pasta da meta; aviso `ready`.
**Where**: `apps/web/src/api.ts`
**Depends on**: None
**Reuses**: `apiFetch`, `readLaunch`
**Requirement**: VSC-04, VSC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Com a meta `vscode`, cada chamada vira uma mensagem e a resposta vira um `Response`; sem a meta, nada muda
- [x] `readLaunch` lê a pasta da meta
- [x] Gate check passes: `pnpm --filter @8n8/web test && pnpm e2e` (a CLI serve a tela com caminhos relativos)

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): talk to the core through the vscode webview bridge`

---

### T2: Pacote `@8n8/vscode` e store da config

**What**: Manifesto, tsconfig, vitest e `createVscodeSettingsStore`.
**Where**: `apps/vscode/src/store.ts`
**Depends on**: None (a fase 1 termina antes)
**Reuses**: `SettingsStore`
**Requirement**: VSC-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A chave vai só para o `SecretStorage`; apagar a chave apaga o segredo; o `globalState` nunca tem a chave
- [x] Gate check passes: `pnpm --filter @8n8/vscode test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(vscode): keep the settings in the editor's secret storage`

---

### T3: Ponte

**What**: `createBridge(app, token)` com a validação do VSC-10 e o Host e o token do VSC-11.
**Where**: `apps/vscode/src/bridge.ts`
**Depends on**: T2
**Reuses**: `createCore`
**Requirement**: VSC-10, VSC-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Cada mensagem inválida recebe 400 sem chegar ao app; uma válida chega com Host e token
- [x] Gate check passes: `pnpm --filter @8n8/vscode test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(vscode): bridge the webview to the core without a port`

---

### T4: HTML da webview

**What**: `webviewHtml` com CSP, nonce, base, metas e sem `crossorigin`.
**Where**: `apps/vscode/src/webview-html.ts`
**Depends on**: T3
**Reuses**: `apps/web/dist/index.html`
**Requirement**: VSC-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A CSP exata do VSC-12; todo `<script>` com o nonce; nenhum `crossorigin`; a pasta escapada na meta
- [x] Gate check passes: `pnpm --filter @8n8/vscode test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(vscode): build the webview page with a strict content policy`

---

### T5: Ativação, comando e build

**What**: `extension.ts` (comando, painel, núcleo, ponte) e `build.ts`.
**Where**: `apps/vscode/src/extension.ts`
**Depends on**: T4
**Reuses**: `createCore`, build da CLI (copiado)
**Requirement**: VSC-01, VSC-02, VSC-03, VSC-06, VSC-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm --filter @8n8/vscode build` gera `dist/extension.cjs`, gramáticas, tela e PTS; teste do build confere os arquivos e que `vscode` ficou externo
- [ ] Gate check passes: `pnpm --filter @8n8/vscode test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(vscode): open the map in a webview panel`

---

### T6: Integração no VS Code real e `.vsix`

**What**: Teste com `@vscode/test-electron`; script `package` com `@vscode/vsce`.
**Where**: `apps/vscode/src/test/suite.ts`
**Depends on**: T5
**Reuses**: fixture `projeto-loja`
**Requirement**: VSC-01, VSC-03, VSC-07, VSC-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O teste abre o painel, recebe `ready` e vê `POST /api/project` 200; o segundo comando reusa o painel
- [ ] `pnpm --filter @8n8/vscode package` gera o `.vsix`
- [ ] Gate check passes: `pnpm --filter @8n8/vscode test:integration`

**Tests**: integration
**Gate**: build

**Commit**: `test(vscode): run the extension in a real vscode and package it`

---

### T7: Guardas da extensão

**What**: Regras `only-vscode-host-imports-vscode` e `vscode-opens-no-port`; casos no teste das guardas; CODEOWNERS.
**Where**: `.dependency-cruiser.cjs`
**Depends on**: None (a fase 2 termina antes)
**Reuses**: `guards.test.ts`
**Requirement**: VSC-09, VSC-13, VSC-14

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Um import de `vscode` fora de `apps/vscode` e um de `node:http` dentro dela fazem o check falhar
- [ ] Gate check passes: `pnpm --filter @8n8/cli test && pnpm check`

**Tests**: unit
**Gate**: quick

**Commit**: `build: keep vscode inside its host and the host without ports`

---

### T8: Documentação

**What**: `docs/adicionar-editor.md`, README (instalar o `.vsix`), CONTRIBUTING e STATE (AD-025).
**Where**: `docs/adicionar-editor.md`
**Depends on**: T7
**Reuses**: guias de linguagem e de provedor
**Requirement**: VSC-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O guia cobre embalagem, `createCore`, `SettingsStore`, ponte sem porta e regras
- [ ] Gate check passes: `pnpm check`

**Tests**: none
**Gate**: build

**Commit**: `docs: guide a new editor host and install the vscode extension`

---

## Phase Execution Map

```
Phase 1: T1
Phase 2: T2 → T3 → T4 → T5 → T6
Phase 3: T7 → T8
```

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | fase 1 | ✅ Match |
| T2 | None (a fase 1 termina antes) | início da fase 2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | None (a fase 2 termina antes) | início da fase 3 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Tela | unit | unit | ✅ OK |
| T2 | Extensão: módulos puros | unit | unit | ✅ OK |
| T3 | Extensão: módulos puros | unit | unit | ✅ OK |
| T4 | Extensão: módulos puros | unit | unit | ✅ OK |
| T5 | Extensão: módulos puros | unit | unit | ✅ OK |
| T6 | Extensão no VS Code real | integration | integration | ✅ OK |
| T7 | Guardas | unit | unit | ✅ OK |
| T8 | Docs | none | none | ✅ OK |
