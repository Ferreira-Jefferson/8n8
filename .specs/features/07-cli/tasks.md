# CLI Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/07-cli/design.md`
**Status**: In Progress

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec - confirm before Execute. Guidelines found: `CLAUDE.md` (Verificação), `CONTRIBUTING.md` (Verificação), memória do usuário "cobrir tudo o que der com Playwright".

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Núcleo: composição e rotas (`packages/server`) | unit (Vitest, `app.request`) | Toda rota `/api/*` atacada; cada guarda com o status exato da spec | `packages/server/src/__tests__/*.test.ts` | `pnpm --filter @8n8/server test` |
| CLI: `run`, `openBrowser`, build (`apps/cli`) | unit (Vitest) | 1:1 com os DIST da CLI; todo caminho de erro com mensagem e código exatos | `apps/cli/src/__tests__/*.test.ts` | `pnpm --filter @8n8/cli test` |
| Tela: `session.ts`, `api.ts`, `App` (`apps/web`) | unit (Vitest + jsdom) | Fragmento lido, guardado, limpo; cabeçalho em toda chamada | `apps/web/src/__tests__/*.test.ts*` | `pnpm --filter @8n8/web test` |
| Ponta a ponta (pacote instalado, navegador) | e2e (Playwright) | Caminho feliz + pasta inexistente + porta ocupada + nada escrito na pasta e na instalação | `e2e/*.e2e.ts` | `pnpm e2e e2e/<spec>.e2e.ts` |
| Config de fronteira e lint | unit (Vitest) | A regra existe e pega uma violação de fixture | `apps/cli/src/__tests__/guards.test.ts` | `pnpm --filter @8n8/cli test` |
| Docs, CODEOWNERS | none | - | - | build gate only |

## Gate Check Commands

> Generated from codebase - confirm before Execute. No Windows, o `pnpm e2e` precisa de `C:\Windows\System32` no PATH (CONTRIBUTING.md).

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `pnpm --filter <pacote> test && pnpm typecheck` |
| Full | After tasks with e2e tests | `pnpm test && pnpm typecheck && pnpm e2e e2e/<spec>.e2e.ts` |
| Build | After phase completion or config-only tasks | `pnpm typecheck && pnpm check && pnpm test && pnpm e2e` |

---

## Execution Plan

### Phase 1: Núcleo e token

A tela aprende a mandar o token antes de o servidor exigir, para o E2E ficar verde em todo commit.

```
T1 → T2 → T3 → T4 → T5
```

### Phase 2: CLI

```
T6 → T7 → T8 → T9
```

### Phase 3: Guardas e documentação

```
T10 → T11
```

---

## Task Breakdown

### T1: Extrair `createCore` do `main.ts`

**What**: Criar `createCore(options: CoreOptions)` com as funções `compose*`, `languagePlugins` e a abertura do histórico vindas do `main.ts`, sem ler `process.env` nem a raiz do repositório.
**Where**: `packages/server/src/core.ts`
**Depends on**: None
**Reuses**: `packages/server/src/main.ts` (`composeLlm`, `composeExplain`, `composeTitles`, `composeReadProject`, `openHistoryOrWarn`)
**Requirement**: DIST-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `packages/server/src/index.ts` exporta `createCore`, `CoreOptions`, `languagePlugins`, `resolvePort`, `listenOptions`; `exports` do pacote aponta para `index.ts`
- [x] `main.ts` fica fino: lê o ambiente e chama `createCore` (sai na T9)
- [x] `main.test.ts` e `compose-languages.test.ts` passam a importar de `core.ts`, sem perder casos
- [x] Teste novo: `core.ts` não referencia `process.env` nem `import.meta.url` (DIST-13)
- [x] Gate check passes: `pnpm --filter @8n8/server test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `refactor(server): move app composition into createCore`

---

### T2: Ler o lançamento do fragmento da URL

**What**: Criar `readLaunch(location, storage, history)`, que lê `t` e `pasta` do fragmento, guarda o token em `sessionStorage`, tira o fragmento da barra e devolve `{ token, folder }`.
**Where**: `apps/web/src/session.ts`
**Depends on**: T1
**Reuses**: nenhum
**Requirement**: DIST-19

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Fragmento `#t=abc&pasta=C%3A%5Cproj` → `{ token: "abc", folder: "C:\\proj" }`, token em `sessionStorage`, `history.replaceState` sem fragmento
- [x] Sem fragmento → token lido do `sessionStorage` (recarregar a página mantém a sessão), `folder: null`
- [x] Nada em `localStorage`
- [x] Gate check passes: `pnpm --filter @8n8/web test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): read the session token and folder from the url fragment`

---

### T3: Mandar o token em toda chamada e abrir a pasta do lançamento

**What**: Fazer toda chamada de `api.ts` passar por um `apiFetch` que põe `x-8n8-token`, e fazer o `App` abrir o mapa de `folder` ao carregar.
**Where**: `apps/web/src/api.ts`
**Depends on**: T2
**Reuses**: `post` e as funções `fetch*` de `api.ts`; o fluxo do formulário de pasta da tela inicial
**Requirement**: DIST-19, DIST-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Toda função de `api.ts` manda `x-8n8-token` quando há token; nenhuma chama `fetch` direto
- [x] Com `folder`, o `App` abre o mapa da pasta sem o usuário digitar nada
- [x] Os testes atuais da web continuam passando
- [x] Gate check passes: `pnpm --filter @8n8/web test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): send the session token on every api call`

---

### T4: Exigir o token no servidor

**What**: Acrescentar a guarda de token (401) entre a guarda de Host e a de JSON, com comparação em tempo constante, e passar o token no `main.ts`, no proxy do Vite e no Playwright.
**Where**: `packages/server/src/app.ts`
**Depends on**: T3
**Reuses**: guardas de `app.ts:164`
**Requirement**: DIST-20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `token.ts` com `sameToken` (SHA-256 + `timingSafeEqual`); `AppDeps.token` obrigatório
- [x] Sem token e com token errado → 401, e nenhum dublê é chamado; arquivos estáticos não pedem token
- [x] `main.ts` usa `APP8N8_TOKEN` (32+ caracteres) ou gera um, e escreve a URL com `#t=`
- [x] `vite.config.ts` põe `x-8n8-token` no proxy; `playwright.config.ts` define `APP8N8_TOKEN` nos webServers e `use.extraHTTPHeaders`
- [x] Os testes de `app` existentes passam a mandar o token
- [x] Gate check passes: `pnpm test && pnpm typecheck && pnpm e2e`

- [x] Desvio: `scripts/dev.mjs` (previsto na T9) entrou aqui, senão o `pnpm dev` ficaria sem token até a T9

**Tests**: unit, e2e
**Gate**: full

**Commit**: `feat(server): require a session token on every api route`

---

### T5: Suíte de segurança do núcleo

**What**: Escrever a suíte que lê `app.routes`, ataca toda rota `/api/*` e confere a chave sentinela em todas as respostas.
**Where**: `packages/server/src/__tests__/security.test.ts`
**Depends on**: T4
**Reuses**: dublês dos testes de `app` existentes
**Requirement**: DIST-21, DIST-22

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Para cada rota de `app.routes` em `/api/*`: Host estranho → 403, POST sem JSON → 415, sem token → 401, token errado → 401; contadores de `explain`, `titles`, `readProject` e histórico em zero
- [x] A suíte falha se `app.routes` tiver uma rota `/api/*` a mais do que ela conhece sem ataque (a lista vem das rotas, não de uma lista escrita à mão)
- [x] `createCore` com `OPENROUTER_API_KEY` sentinela e LLM falso: nenhuma resposta (corpo ou cabeçalho) contém a sentinela
- [x] Gate check passes: `pnpm --filter @8n8/server test && pnpm typecheck`

- [x] Achado: a mensagem de erro do provedor chegava ao navegador com a chave (`explain.ts:134`). Corrigido em `core.ts` (`withoutKey`), que apaga a chave inteira e a forma mascarada

**Tests**: unit
**Gate**: quick

**Commit**: `test(server): attack every api route and check the sentinel key`

---

### T6: `run` da CLI

**What**: Criar `run(argv, deps)` com `util.parseArgs`, `--help`, `--no-open`, pasta, token, pastas de dados e saída, e a entrada `main.ts` do repositório.
**Where**: `apps/cli/src/run.ts`
**Depends on**: None
**Reuses**: `createCore`, `resolvePort`, `listenOptions` de `@8n8/server`
**Requirement**: DIST-02, DIST-03, DIST-04, DIST-05, DIST-06, DIST-07, DIST-08, DIST-09, DIST-11, DIST-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `apps/cli/package.json` (`@8n8/cli`), `tsconfig.json`, `src/listen.ts`; regra `cli-only-server` no dependency-cruiser. Desvio: `src/main.ts` foi para a T7, porque usa o `openBrowser`
- [x] Sem pasta → URL só com `#t=`; com pasta relativa → resolvida pelo `cwd`; `C:\p` e `C:/p` → o mesmo caminho
- [x] Pasta inexistente → `Pasta não encontrada: <caminho>`, código 1, `openBrowser` não chamado
- [x] Porta em uso → mensagem exata do DIST-06, código 1
- [x] Saída `8n8 em http://127.0.0.1:<porta>/#t=<token>` antes de `openBrowser`; `--no-open` não chama `openBrowser`
- [x] `--help` → uso com `--no-open`, `APP8N8_PORT`, `APP8N8_CACHE_DIR`, `APP8N8_HISTORY_DIR` e as variáveis de LLM; código 0; `serve` não chamado
- [x] Pastas padrão `~/.8n8/historico.db` e `APP8N8_HISTORY_DIR` testadas aqui. A pasta padrão `~/.8n8/cache` só é escrita quando o LLM responde: a prova foi para o E2E da T9
- [x] Sem config de LLM → sobe normalmente (a resposta `no-key` do núcleo segue a mesma)
- [x] `APP8N8_TOKEN` com menos de 32 caracteres → erro e código 1
- [x] Sentinela em `OPENROUTER_API_KEY` não aparece em `out` nem `err`
- [x] Gate check passes: `pnpm --filter @8n8/cli test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(cli): add the run entry with arguments, token and data folders`

---

### T7: Abrir o navegador sem shell

**What**: Criar `openBrowser(url, spawn, platform)` com `rundll32 url.dll,FileProtocolHandler` no Windows, `open` no macOS e `xdg-open` no Linux, sempre com argumentos em lista.
**Where**: `apps/cli/src/open-browser.ts`
**Depends on**: T6
**Reuses**: nenhum
**Requirement**: DIST-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Para cada plataforma, `spawn` recebe o comando e a URL como argumento separado, sem `shell: true`
- [x] Um erro do `spawn` não derruba a CLI
- [x] Conferido nesta máquina: o navegador abre com o fragmento `#t=...&pasta=...` inteiro (conferido: `#t=abc123&pasta=C%3A%5CUsers%5Cx%20y` chegou idêntico; plano B descartado)
- [x] Gate check passes: `pnpm --filter @8n8/cli test && pnpm typecheck`

- [x] `src/main.ts` (entrada do repositório), vindo da T6; teste de fumaça: token → 200, sem token → 401, pasta inexistente → código 1

**Tests**: unit
**Gate**: quick

**Commit**: `feat(cli): open the default browser without a shell`

---

### T8: Build do pacote da CLI

**What**: Criar `build.mjs` (esbuild + troca do `node:module` dos plugins + cópia de gramáticas, tela e PTS) e a entrada `bin.ts` do bundle, com filtro do aviso de SQLite.
**Where**: `apps/cli/build.mjs`
**Depends on**: T7
**Reuses**: protótipo do design (plugin `grammars`)
**Requirement**: DIST-12, DIST-16

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `pnpm --filter @8n8/cli build` gera `dist/8n8.mjs` (filtro do aviso), `dist/cli.mjs` (o resto), `dist/web-tree-sitter.wasm`, `dist/grammars/*.wasm`, `dist/web/`, `dist/pts.md`
- [x] Teste de fumaça: o bundle, rodado de uma pasta temporária, extrai um trecho Python e um TypeScript
- [x] Teste do pacote: o `package.json` publicado não tem `dependencies` nem `preinstall`/`install`/`postinstall`; `bin` aponta para `dist/8n8.mjs`; `engines.node` é `>=22.13.0`; `files` é só `dist`
- [x] O aviso "SQLite is an experimental feature" não aparece no terminal. Plano B usado: o bundle único subia o import do `node:sqlite` para antes do filtro, então o pacote tem dois arquivos e o `8n8.mjs` carrega o `cli.mjs` depois do filtro. Conferido rodando o `dist` copiado para fora do repositório: `stderr` vazio no `--help`, tela servida, fixture mapeada. A prova automática fica no E2E da T9
- [x] Gate check passes: `pnpm --filter @8n8/cli test && pnpm typecheck`

**Tests**: unit
**Gate**: quick

**Commit**: `build(cli): bundle the cli with grammars, web app and pts rules`

---

### T9: Trocar os scripts do repositório para a CLI e testar a instalação

**What**: Fazer `pnpm dev`, `pnpm start` e o E2E usarem a CLI (`scripts/dev.mjs`, bundle com `--no-open`), apagar `packages/server/src/main.ts` e escrever o E2E da CLI instalada.
**Where**: `e2e/cli.e2e.ts`
**Depends on**: T8
**Reuses**: fixture `projeto-loja`, servidores do `playwright.config.ts`
**Requirement**: DIST-01, DIST-05, DIST-06, DIST-10, DIST-12, DIST-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `package.json` da raiz: `dev` → `node scripts/dev.mjs`; `start` → build da CLI + `node --env-file-if-exists=.env apps/cli/dist/8n8.mjs --no-open`; `e2e` → build da CLI + `playwright test`
- [x] Os webServers do Playwright rodam `node apps/cli/dist/8n8.mjs --no-open`
- [x] E2E: `pnpm pack` + `npm install -g --prefix <temp>`; `8n8 <fixture> --no-open` numa porta própria; a página com `#t=...&pasta=...` mostra os nós da fixture
- [x] E2E: `8n8 --help` do pacote instalado não escreve `ExperimentalWarning` no `stderr`
- [x] E2E: pasta inexistente → código 1 e mensagem; porta ocupada → código 1 e mensagem
- [x] E2E: com a pasta pessoal apontada para uma pasta temporária e o LLM falso, a explicação grava em `<home>/.8n8/cache` (DIST-09)
- [x] E2E: a fixture e a pasta de instalação ficam iguais antes e depois (lista de arquivos e conteúdo)
- [x] E2E: abrir só com `#t=` (sem `extraHTTPHeaders`) carrega a tela e chama a API com sucesso
- [x] `pnpm dev` sobe e a tela chama a API (conferido à mão: `/api/languages` pelo proxy do Vite responde; direto no servidor sem token, 401). O `scripts/dev.mjs` deixou de passar argumentos ao shell (aviso DEP0190 do Node)
- [x] Gate check passes: `pnpm test && pnpm typecheck && pnpm e2e`

- [x] O teste do cache usa um `contagem.py` que o LLM falso resume com aprovação; o nó da fixture (`calcular_frete`) volta como `unfaithful` e não entra no cache

**Tests**: e2e
**Gate**: full

**Commit**: `feat(cli): run dev, start and e2e through the cli and test the installed package`

---

### T10: Guardas de build

**What**: Acrescentar ao `.dependency-cruiser.cjs` a proibição de `node:child_process` (exceto `apps/cli/src/open-browser.ts`) e de imports entre embalagens, deixar explícitas no `biome.json` as regras de `eval`, `Function` e `dangerouslySetInnerHTML`, e testar que elas pegam violações.
**Where**: `apps/cli/src/__tests__/guards.test.ts`
**Depends on**: None
**Reuses**: `.dependency-cruiser.cjs`, `biome.json`
**Requirement**: DIST-14, DIST-23

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `cruise()` (API do dependency-cruiser) numa fixture com `import "node:child_process"` → violação; o mesmo import em `open-browser.ts` → sem violação
- [ ] `cruise()` numa fixture onde `packages/` ou `apps/web` importa `apps/cli` → violação
- [ ] `biome.json` tem `noGlobalEval`, `noDangerouslySetInnerHtml` e a restrição do global `Function` como `"error"`; o teste lê e confere
- [ ] As fixtures ficam fora do `pnpm check` normal
- [ ] Gate check passes: `pnpm typecheck && pnpm check && pnpm test`

**Tests**: unit
**Gate**: build

**Commit**: `build: forbid child_process, eval and cross-host imports in check`

---

### T11: CODEOWNERS e documentação

**What**: Criar `.github/CODEOWNERS` com os arquivos de segurança e atualizar README (instalar e usar a CLI), CONTRIBUTING (comandos) e `docs/adicionar-linguagem.md` (padrão de carga da gramática).
**Where**: `.github/CODEOWNERS`
**Depends on**: T10
**Reuses**: README, CONTRIBUTING, guia de linguagem
**Requirement**: DIST-24

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `CODEOWNERS` lista as guardas do `server`, a suíte de segurança, `.dependency-cruiser.cjs`, `biome.json`, `pnpm-workspace.yaml`, `.githooks/`, `.gitleaks.toml` e o próprio `CODEOWNERS`
- [ ] README: `pnpm pack`, `npm install -g`, `8n8 [pasta]`, `--no-open`, `~/.8n8`
- [ ] Gate check passes: `pnpm typecheck && pnpm check && pnpm test && pnpm e2e`

**Tests**: none
**Gate**: build

**Commit**: `docs: add codeowners and document the cli`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 → T2 → T3 → T4 → T5
Phase 2:  T6 → T7 → T8 → T9
Phase 3:  T10 → T11
```

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | início da fase 1 | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | T4 → T5 | ✅ Match |
| T6 | None (a fase 1 termina antes) | início da fase 2 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | None (a fase 2 termina antes) | início da fase 3 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Núcleo | unit | unit | ✅ OK |
| T2 | Tela | unit | unit | ✅ OK |
| T3 | Tela | unit | unit | ✅ OK |
| T4 | Núcleo + config de E2E | unit + e2e | unit, e2e | ✅ OK |
| T5 | Núcleo | unit | unit | ✅ OK |
| T6 | CLI | unit | unit | ✅ OK |
| T7 | CLI | unit | unit | ✅ OK |
| T8 | CLI (build) | unit | unit | ✅ OK |
| T9 | Ponta a ponta | e2e | e2e | ✅ OK |
| T10 | Config de fronteira e lint | unit | unit | ✅ OK |
| T11 | Docs, CODEOWNERS | none | none | ✅ OK |
