# Configurações e LLM sob demanda Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/08-config-llm-sob-demanda/design.md`
**Status**: In Progress

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Tipos (`packages/model`) | none | Só tipos; o typecheck cobre | - | `pnpm typecheck` |
| Pipeline de explicação (`packages/explain`) | unit (Vitest) | Cada parte: prompt, parser, cache, `cachedOnly`, status | `packages/explain/src/__tests__/*.test.ts` | `pnpm --filter @8n8/explain test` |
| Config do LLM (`packages/llm`) | unit (Vitest) | Cada regra de precedência do CFG-16 | `packages/llm/src/__tests__/*.test.ts` | `pnpm --filter @8n8/llm test` |
| Núcleo: serviço, arquivo, rotas (`packages/server`) | unit (Vitest, `app.request`) | Cada AC de rota com status e corpo exatos; suíte de segurança | `packages/server/src/__tests__/*.test.ts` | `pnpm --filter @8n8/server test` |
| CLI (`apps/cli`) | unit (Vitest) | Pasta da config, permissão, saída sem chave | `apps/cli/src/__tests__/*.test.ts` | `pnpm --filter @8n8/cli test` |
| Tela (`apps/web`) | unit (Vitest + jsdom) | Botões, modos, diálogo, campos do ambiente | `apps/web/src/**/__tests__/*.test.ts*` | `pnpm --filter @8n8/web test` |
| Ponta a ponta | e2e (Playwright) | Modo por clique, cache sem clique, salvar a config pela tela | `e2e/*.e2e.ts` | `pnpm e2e e2e/<spec>.e2e.ts` |
| Docs | none | - | - | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm --filter <pacote> test && pnpm typecheck` |
| Full | After tasks with e2e tests | `pnpm test && pnpm typecheck && pnpm e2e e2e/<spec>.e2e.ts` |
| Build | After phase completion or config-only tasks | `pnpm typecheck && pnpm check && pnpm test && pnpm e2e` |

---

## Execution Plan

### Phase 1: Duas partes no pipeline

```
T1 → T2 → T3 → T4
```

### Phase 2: Config no núcleo e na CLI

```
T5 → T6 → T7 → T8
```

### Phase 3: Tela e ponta a ponta

```
T9 → T10 → T11 → T12 → T13
```

---

## Task Breakdown

### T1: Tipos das duas partes e da config

**What**: Trocar `Explanation` por `Summary`, tornar `ExplainResponse` genérico (`result`, `not-cached`) e criar `StoredSettings`, `SettingsPatch` e `SettingsResponse`.
**Where**: `packages/model/src/explanation.ts`, `packages/model/src/settings.ts`, `packages/model/src/index.ts`
**Depends on**: None
**Reuses**: `ExplainResponse` atual
**Requirement**: CFG-01, CFG-02, CFG-05, CFG-12, CFG-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Tipos exportados pelo `index.ts`
- [x] Gate check passes: `pnpm --filter @8n8/model test` (os consumidores quebram até a T4 e a T10; o typecheck do repositório volta na T10)

**Tests**: none
**Gate**: quick

**Commit**: `feat(model): split explanation into summary and suggestions types`

---

### T2: Prompts e parsers de cada parte

**What**: Criar os prompts do resumo, do resumo de passo e das sugestões, e os parsers `parseSummary` e `parseSuggestions`.
**Where**: `packages/explain/src/prompt.ts`, `packages/explain/src/schema.ts`
**Depends on**: T1
**Reuses**: `FORMAT` e `buildStepPrompt` atuais
**Requirement**: CFG-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] O prompt do resumo pede `summary`, `inputs` e `outputs`, e não cita `suggestions` nem `docstring`
- [x] O prompt das sugestões pede `suggestions` e `docstring`, e não pede `summary`
- [x] `parseSuggestions` mantém o corte de linha e o limite de 5 (CORE-22)
- [x] Gate check passes: `pnpm --filter @8n8/explain test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(explain): give summary and suggestions their own prompts`

---

### T3: Um cache por parte

**What**: Trocar `createDiskCache` por `createPartCache(dir, folder, schema)`, com `createSummaryCache` (`nodes/`) e `createSuggestionsCache` (`suggestions/`), `schemaVersion: 4`.
**Where**: `packages/explain/src/cache.ts`
**Depends on**: T2
**Reuses**: escrita atômica atual
**Requirement**: CFG-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Cada parte grava na sua pasta; uma entrada v3 conta como ausente
- [x] Gate check passes: `pnpm --filter @8n8/explain test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(explain): keep summary and suggestions in separate caches`

---

### T4: `summarizeNode` e `suggestNode`

**What**: Criar as duas funções sobre um `explainPart` com `cachedOnly`, com a revisão por parte e a impressão digital do resumo sem docstring.
**Where**: `packages/explain/src/explain.ts`, `packages/explain/src/review.ts`, `packages/explain/src/index.ts`
**Depends on**: T3
**Reuses**: `reviewedDraft`, `fingerprintOf`
**Requirement**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Resumo sem frase sobrevivente → `unfaithful`; sugestões todas cortadas → `ok` com lista vazia
- [ ] `cachedOnly` sem acerto → `not-cached` e nenhuma chamada ao LLM
- [ ] A mensagem do resumo não tem o bloco da docstring; editar a docstring não invalida o resumo e invalida as sugestões
- [ ] Os testes atuais do pipeline passam para a parte correspondente, sem perder casos
- [ ] Gate check passes: `pnpm --filter @8n8/explain test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(explain): explain a node in two parts with a cache-only mode`

---

### T5: Config do LLM com valor guardado

**What**: `resolveLlmConfig(env, stored)` com a precedência do CFG-16 e `envNames(env)`.
**Where**: `packages/llm/src/config.ts`
**Depends on**: None (a fase 1 termina antes)
**Reuses**: `providerOf`
**Requirement**: CFG-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Ambiente ganha do guardado, guardado ganha do padrão, campo a campo
- [ ] Chave, URL e modelo guardados não valem para outro provedor
- [ ] Gate check passes: `pnpm --filter @8n8/llm test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(llm): resolve the config from the environment and stored settings`

---

### T6: Serviço de config e armazenamento em arquivo

**What**: `createSettingsService(env, store)` (`view`, `update`, `llm`) e `createFileSettingsStore(path)`.
**Where**: `packages/server/src/settings.ts`, `packages/server/src/settings-file.ts`
**Depends on**: T5
**Reuses**: `withoutKey`, escrita atômica do cache
**Requirement**: CFG-12, CFG-13, CFG-14, CFG-15, CFG-17, CFG-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `view()` nunca tem a chave; `env` dá o nome da variável de cada campo definido
- [ ] Corpo inválido (campo extra, provedor desconhecido, URL sem http(s), chave vazia) lança erro de validação e não grava
- [ ] Troca de provedor ou URL apaga a chave, salvo chave nova no mesmo patch
- [ ] `llm()` monta um cliente novo só quando a config muda
- [ ] Arquivo: ilegível → `{}`; escrita atômica com `0o600`
- [ ] Gate check passes: `pnpm --filter @8n8/server test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): add the settings service and its file store`

---

### T7: Rotas novas e núcleo com a config atual

**What**: `POST /api/summary`, `POST /api/suggestions`, `GET/PUT /api/settings`; `createCore` recebe `settings` e compõe explain e títulos com a config atual; sai `POST /api/explain`.
**Where**: `packages/server/src/app.ts`, `packages/server/src/core.ts`
**Depends on**: T6
**Reuses**: handler atual de `/api/explain`
**Requirement**: CFG-01, CFG-02, CFG-05, CFG-12, CFG-13, CFG-14, CFG-17, CFG-18, CFG-23, CFG-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Testes de rota de cada parte (status, corpo, `cachedOnly`, 404, 400)
- [ ] `PUT` seguido de pedido usa a config nova sem recriar o app
- [ ] Suíte de segurança: chave sentinela gravada pelo `PUT` não aparece em resposta nenhuma, nem em erro do provedor; `GET`/`PUT /api/settings` atacadas sem gravar
- [ ] Gate check passes: `pnpm --filter @8n8/server test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): serve summary, suggestions and settings routes`

---

### T8: Config da CLI em `config.json`

**What**: A CLI passa `createFileSettingsStore(<APP8N8_CONFIG_DIR ou ~/.8n8>/config.json)` ao núcleo e lista as variáveis novas no `--help`.
**Where**: `apps/cli/src/run.ts`
**Depends on**: T7
**Reuses**: `RunDeps`
**Requirement**: CFG-19, CFG-25

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `PUT` pela CLI grava em `<home>/.8n8/config.json` ou em `APP8N8_CONFIG_DIR`
- [ ] Permissão `0o600` conferida fora do Windows; a saída nunca tem a chave guardada
- [ ] Gate check passes: `pnpm --filter @8n8/cli test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(cli): keep the settings in the user's config file`

---

### T9: Cliente da API na tela

**What**: `fetchSummary`, `fetchSuggestions` (com `cachedOnly`), `fetchSettings`, `saveSettings`.
**Where**: `apps/web/src/api.ts`
**Depends on**: None (a fase 2 termina antes)
**Reuses**: `apiFetch`, `post`
**Requirement**: CFG-05, CFG-12, CFG-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cada função manda o token e o corpo certo; 404 → `stale`; falha de rede → `error`
- [ ] Gate check passes: `pnpm --filter @8n8/web test`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): call the summary, suggestions and settings routes`

---

### T10: Painel com resumo e sugestões sob demanda

**What**: `DetailPanel` com duas seções, botões, modos automáticos e o aviso sem provedor; `App` e os cartões de sugestão passam a usar as sugestões.
**Where**: `apps/web/src/panel/DetailPanel.tsx`, `apps/web/src/App.tsx`, `apps/web/src/flow/suggestion-cards.ts`, `apps/web/src/flow/FlowCanvas.tsx`
**Depends on**: T9
**Reuses**: `SummaryView`, `SuggestionsView`
**Requirement**: CFG-06, CFG-07, CFG-08, CFG-09, CFG-10, CFG-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Modo por clique: pedido `cachedOnly`, acerto aparece, senão botão; clique pede de verdade
- [ ] Modo automático: pedido de verdade ao selecionar
- [ ] Sem provedor: texto do CFG-09 e botão que abre as configurações
- [ ] Cartões e contagem vêm só das sugestões; lista vazia mostra o texto do CFG-11
- [ ] Gate check passes: `pnpm --filter @8n8/web test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): ask for the summary and the suggestions on demand`

---

### T11: Diálogo de configurações

**What**: `SettingsDialog` e o botão "Configurações" em todas as vistas; `App` lê a config ao abrir e passa os modos ao painel.
**Where**: `apps/web/src/settings/SettingsDialog.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
**Depends on**: T10
**Reuses**: tokens CSS (AD-018)
**Requirement**: CFG-20, CFG-21, CFG-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Campos do CFG-20; "Chave guardada" com `hasKey`; "Apagar chave" manda `apiKey: null`
- [ ] Salvar manda só o que mudou; sucesso e erro com os textos do CFG-21
- [ ] Campo definido pelo ambiente fica desativado com o nome da variável
- [ ] Gate check passes: `pnpm --filter @8n8/web test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add the settings dialog`

---

### T12: Ponta a ponta

**What**: Servidores E2E com `APP8N8_CONFIG_DIR` próprio e modos automáticos nos servidores antigos; papel `suggest` no LLM falso; specs antigos ajustados; spec novo `configuracoes.e2e.ts`; `cli.e2e.ts` clica em "Gerar resumo".
**Where**: `playwright.config.ts`, `e2e/fake-llm.ts`, `e2e/*.e2e.ts`
**Depends on**: T11
**Reuses**: LLM falso, `mapa.ts`
**Requirement**: CFG-06, CFG-07, CFG-09, CFG-17, CFG-20, CFG-21

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Modo por clique: selecionar não chama o LLM; o clique chama só a parte pedida; o cache aparece sem clique
- [ ] Salvar chave falsa e URL do LLM falso pelo diálogo liga o "Gerar resumo" sem reiniciar
- [ ] Gate check passes: `pnpm typecheck && pnpm check && pnpm test && pnpm e2e`

**Tests**: e2e
**Gate**: build

**Commit**: `test(e2e): cover on-demand explanations and the settings dialog`

---

### T13: Documentação e estado

**What**: README (configurações pela tela), guia de provedor (config guardada), STATE (AD-023 implementada, handoff).
**Where**: `README.md`, `docs/adicionar-provedor-llm.md`, `.specs/STATE.md`
**Depends on**: T12
**Reuses**: nenhum
**Requirement**: CFG-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] README explica o painel, o `config.json` e as variáveis que ganham do painel
- [ ] Gate check passes: `pnpm check`

**Tests**: none
**Gate**: build

**Commit**: `docs: explain the settings panel and on-demand explanations`

---

## Phase Execution Map

```
Phase 1: T1 → T2 → T3 → T4
Phase 2: T5 → T6 → T7 → T8
Phase 3: T9 → T10 → T11 → T12 → T13
```

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | início da fase 1 | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | None (a fase 1 termina antes) | início da fase 2 | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | None (a fase 2 termina antes) | início da fase 3 | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | T11 → T12 | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Tipos | none | none | ✅ OK |
| T2 | Pipeline | unit | unit | ✅ OK |
| T3 | Pipeline | unit | unit | ✅ OK |
| T4 | Pipeline | unit | unit | ✅ OK |
| T5 | Config do LLM | unit | unit | ✅ OK |
| T6 | Núcleo | unit | unit | ✅ OK |
| T7 | Núcleo | unit | unit | ✅ OK |
| T8 | CLI | unit | unit | ✅ OK |
| T9 | Tela | unit | unit | ✅ OK |
| T10 | Tela | unit | unit | ✅ OK |
| T11 | Tela | unit | unit | ✅ OK |
| T12 | Ponta a ponta | e2e | e2e | ✅ OK |
| T13 | Docs | none | none | ✅ OK |
