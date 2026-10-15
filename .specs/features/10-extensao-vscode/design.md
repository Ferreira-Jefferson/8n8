# Extensão VS Code Design

**Spec**: `.specs/features/10-extensao-vscode/spec.md`
**Status**: Approved (o usuário dispensou as aprovações em 2026-10-15)

---

## Architecture Overview

A extensão é a segunda embalagem do núcleo (AD-022). Ela monta o app com `createCore` dentro do host de extensões e nunca abre porta. A tela empacotada roda numa webview e fala com a extensão por `postMessage`; a extensão transforma cada mensagem num `Request` e chama `app.fetch`.

```mermaid
graph LR
    subgraph "Webview (apps/ui empacotada)"
      API[api.ts: apiFetch] -->|postMessage {id, method, path, body}| HOSTMSG
    end
    subgraph "Host de extensões (apps/editors/vscode)"
      HOSTMSG[bridge.ts: valida, põe Host e token] -->|app.fetch Request| CORE[createCore]
      EXT[extension.ts: comando, painel] --> HTML[webview-html.ts: CSP, nonce, base]
      EXT --> STORE[store.ts: SecretStorage + globalState]
      CORE --> STORE
    end
    CORE -->|resposta| HOSTMSG -->|postMessage {id, status, body}| API
```

**Fluxo de "8n8: Abrir mapa":** o comando resolve a pasta (argumento do Explorer, primeira pasta da área de trabalho ou diálogo) → cria o núcleo uma vez por ativação → cria ou reusa o painel → monta o HTML com a pasta numa `<meta>` → a página carrega, avisa `ready`, lê a pasta e pede `POST /api/project` pela ponte.

---

## Code Reuse Analysis

| Component | Location | How to Use |
| --------- | -------- | ---------- |
| `createCore`, `CoreOptions`, `SettingsStore` | `packages/server/src/index.ts` | A extensão passa env, pastas de dados, token e o seu `SettingsStore`. |
| `apiFetch` | `apps/ui/src/api.ts` | Ganha um transporte: `fetch` na CLI, `postMessage` na webview. As funções da API não mudam. |
| `readLaunch` | `apps/ui/src/session.ts` | Lê também a pasta da `<meta name="8n8-folder">`. |
| Build da CLI (bundle, gramáticas, tela, PTS) | `apps/cli/src/build.ts` | Copiado, não importado: uma embalagem não importa outra. A extensão sai em CommonJS com `vscode` externo. |
| Guardas reais do check | `apps/cli/src/__tests__/guards.test.ts` | Ganham os casos de `vscode` fora da extensão e de porta dentro dela. |

---

## Components

### `apps/ui`

- `vite.config.ts`: `base: "./"`.
- `api.ts`: `apiFetch` usa a ponte quando a página tem `<meta name="8n8-host" content="vscode">` e o global `acquireVsCodeApi` existe. A ponte devolve um `Response` montado com o status e o corpo, então as funções de cima não mudam.
- `session.ts`: `readLaunch` lê a pasta da `<meta name="8n8-folder">` quando não há fragmento.
- `main.tsx`: na webview, manda `{type: "ready"}` ao montar.

### `apps/editors/vscode`

- `package.json`: manifesto (`main: dist/extension.cjs`, `engines.vscode: ^1.138.0`, comando `8n8.abrirMapa`, menu do Explorer em pastas), scripts `build`, `test`, `test:integration`, `package`.
- `src/store.ts`: `createVscodeSettingsStore(secrets, memento)`: a chave no `SecretStorage` (`8n8.apiKey`), o resto no `globalState` (`8n8.settings`).
- `src/bridge.ts`: `createBridge(app, token)`: `handle(message)` valida (VSC-10), monta o `Request` com `host: 127.0.0.1:4317` e `x-8n8-token`, chama `app.fetch` e devolve `{id, status, body}`.
- `src/webview-html.ts`: `webviewHtml(indexHtml, {baseUri, cspSource, nonce, folder})`: tira `crossorigin`, põe `nonce` nos `<script>`, a `<base href>`, a CSP e as `<meta>` de host e pasta.
- `src/extension.ts`: `activate` registra o comando; cria o núcleo na primeira vez; cria ou reusa o painel; liga a ponte; devolve uma API de teste (`{ ready, calls }`) para o teste de integração.
- `src/build.ts`: esbuild (CJS, `external: ["vscode"]`), gramáticas, tela e PTS em `dist/`.
- `src/test/`: teste de integração (mocha dentro do VS Code), rodado por `@vscode/test-electron`.

### Guardas

- `.dependency-cruiser.cjs`: regra `only-vscode-host-imports-vscode` (de fora de `apps/editors/vscode/` para `^vscode$`) e regra `vscode-opens-no-port` (de `apps/editors/vscode/` para `@hono/node-server`, `node:http`, `node:https`, `node:net`).

---

## Tech Decisions

| Decision | Choice | Rationale |
| -------- | ------ | --------- |
| Transporte | `postMessage` + `app.fetch` | Nenhuma porta: só a webview alcança a API. |
| Token | Gerado pela extensão, posto pela ponte | A webview não precisa dele; o núcleo continua exigindo. |
| Caminhos da tela | `base: "./"` + `<base href>` | Um build para as duas embalagens. As fontes do CSS resolvem pelo endereço do próprio CSS. |
| `crossorigin` | Removido dos `<script>` e `<link>` | O servidor de recursos da webview não responde CORS para módulos. |
| Testes | Vitest nos módulos puros; `@vscode/test-electron` no fluxo real | O módulo `vscode` só existe dentro do VS Code. |
