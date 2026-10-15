# Extensão VS Code Specification

## Problem Statement

A AD-022 define duas embalagens sobre o mesmo núcleo: a CLI (feature 07) e a extensão do VS Code. O autor trabalha no VS Code. Hoje, para ver o mapa de uma pasta, ele sai do editor, abre um terminal e um navegador. A extensão abre o mesmo mapa num painel do VS Code, ao lado do código.

O teste da AD-022 mostrou que o `node:sqlite` e o `web-tree-sitter` funcionam no host de extensões do VS Code 1.141 (Node 24.21). Um teste de 2026-10-15 mostrou que um `Request` do Node aceita o cabeçalho `Host`, então a extensão pode chamar o núcleo dentro do próprio processo (`app.fetch`), sem abrir porta.

Depende de: 07-cli, 08-config-llm-sob-demanda, 09-provedor-claude-code.

## Done When

O usuário instala o `.vsix` gerado pelo repositório, abre uma pasta no VS Code, roda "8n8: Abrir mapa" na paleta de comandos e vê o mapa da pasta num painel ao lado do código, com resumo, sugestões e Configurações funcionando como na CLI.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Publicar no Marketplace | Ação externa e visível. Exige pedido explícito. A instalação é local, pelo `.vsix`. |
| Abrir o arquivo do nó no editor ao clicar | Melhoria futura. O painel já mostra o código e as linhas. |
| `vscode.lm` (modelos do Copilot) como provedor | Fora do uso do autor (AD-022). Fica como ponto de extensão. |
| Configurações do 8n8 na tela de Settings do VS Code | O diálogo de Configurações da tela já cobre tudo, igual na CLI. |
| Atualizar o mapa quando um arquivo muda | Igual à CLI: o usuário roda o comando de novo. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Como a tela fala com o núcleo | `postMessage` da webview para a extensão, que chama `app.fetch` no mesmo processo | Nenhuma porta aberta: nenhum outro programa da máquina alcança a API. | y |
| Versão mínima do VS Code | `^1.138.0` (`engines.vscode`), testada no 1.141 | O núcleo precisa do `node:sqlite` sem flag (Node 22.13+). Os tipos usados são os da 1.138. | y |
| Onde ficam os dados | Cache e histórico na pasta global da extensão (`globalStorageUri`); a chave no `SecretStorage`; o resto da config no `globalState` | AD-023. A chave nunca fica em arquivo de texto. | y |
| Nome e id | Comando `8n8.abrirMapa`; painel "8n8"; extensão `8n8` | Um comando só, com a pasta vinda do Explorer ou da área de trabalho. | y |
| Prédio da tela | O build da tela passa a usar caminhos relativos (`base: "./"`), e a webview recebe uma tag `<base>` apontando para a pasta da tela | O mesmo build serve a CLI (na raiz) e a webview. | y |

**Open questions:** none.

---

## User Stories

### P1: Abrir o mapa dentro do VS Code ⭐ MVP

**User Story**: Como desenvolvedor no VS Code, quero abrir o mapa da pasta do projeto num painel do editor, sem terminal e sem navegador.

**Why P1**: É o jeito como o autor trabalha.

**Acceptance Criteria**:

1. WHEN o usuário roda "8n8: Abrir mapa" na paleta THEN a extensão SHALL abrir um painel "8n8" ao lado do editor com o mapa da primeira pasta da área de trabalho. IF não há pasta aberta THEN a extensão SHALL pedir uma pasta num diálogo, e cancelar o diálogo não SHALL abrir nada.  <!-- VSC-01 -->
2. WHEN o usuário escolhe "8n8: Abrir mapa desta pasta" no menu de contexto de uma pasta do Explorer THEN a extensão SHALL abrir o mapa dessa pasta.  <!-- VSC-02 -->
3. WHEN o painel já existe e o comando roda de novo THEN a extensão SHALL reusar o painel, trazê-lo à frente e abrir o mapa da pasta nova.  <!-- VSC-03 -->
4. The tela SHALL funcionar na webview com as mesmas funções da CLI: mapa, painel de detalhe, resumo e sugestões, histórico e Configurações.  <!-- VSC-04 -->
5. The extensão SHALL guardar o cache e o histórico na pasta global da extensão, a chave de API no `SecretStorage` do VS Code e o resto da config no `globalState`. A chave nunca SHALL ir para o `globalState`.  <!-- VSC-05 -->
6. The extensão SHALL passar ao núcleo o ambiente do host de extensões, então as variáveis da AD-021, da 08 e da 09 (`APP8N8_*`, `OPENROUTER_*`, `APP8N8_CLAUDE_PATH`) valem como na CLI.  <!-- VSC-06 -->
7. WHEN o usuário roda `pnpm --filter @8n8/vscode package` THEN o repositório SHALL gerar `apps/vscode/8n8-<versão>.vsix` com a extensão empacotada num arquivo só, as gramáticas, a tela e as regras de PTS, sem dependências e sem scripts de instalação.  <!-- VSC-07 -->
8. The teste de integração SHALL rodar num VS Code real (`@vscode/test-electron`): o comando abre o painel de uma pasta de teste, a página carrega sob a CSP e avisa que está pronta, pede `POST /api/project` pela ponte e recebe 200.  <!-- VSC-08 -->

**Independent Test**: o teste de integração abre o painel numa pasta com um arquivo Python e vê a ponte responder ao mapa.

---

### P1 (segurança): A webview só fala com o núcleo, e o núcleo não abre porta

**User Story**: Como usuário, quero que a extensão não abra nenhuma porta e que a página do painel só consiga pedir o que a API permite, para que nenhum outro programa nem página use a minha chave ou a minha assinatura.

**Why P1**: A extensão carrega a mesma chave e o mesmo Claude Code da CLI.

**Acceptance Criteria**:

1. The extensão nunca SHALL abrir porta: o código de `apps/vscode` não importa `@hono/node-server`, `node:http`, `node:https` nem `node:net`, e o `pnpm check` SHALL falhar se importar.  <!-- VSC-09 -->
2. WHEN a webview manda uma mensagem THEN a ponte SHALL aceitar só `{id, method, path, body?}` com `method` em `GET`, `POST`, `PUT`, `DELETE`, `path` que começa com `/api/` sem `..`, sem `//`, sem `\` e sem esquema, e `body` texto de no máximo 1 MB. Qualquer outra mensagem SHALL receber status 400 sem chegar ao núcleo.  <!-- VSC-10 -->
3. The ponte SHALL pôr ela mesma o cabeçalho `Host` aceito pela guarda e o token da sessão. A webview nunca SHALL receber o token, e o núcleo continua recusando um pedido sem ele (DIST-20).  <!-- VSC-11 -->
4. The HTML da webview SHALL ter a CSP `default-src 'none'`, `script-src 'nonce-<aleatório>'`, `style-src <cspSource> 'unsafe-inline'`, `font-src <cspSource>`, `img-src <cspSource> data:` e `connect-src 'none'`. The webview SHALL ter `localResourceRoots` só com a pasta da tela empacotada.  <!-- VSC-12 -->
5. The `pnpm check` SHALL falhar se um arquivo fora de `apps/vscode` importa o módulo `vscode`, e o teste das guardas SHALL provar isso com um arquivo que viola a regra.  <!-- VSC-13 -->
6. The `.github/CODEOWNERS` SHALL exigir o dono do projeto como revisor da ponte (`apps/vscode/src/bridge.ts`) e do HTML da webview (`apps/vscode/src/webview-html.ts`).  <!-- VSC-14 -->

**Independent Test**: `pnpm test` roda os testes da ponte e da CSP, e o teste das guardas faz o `pnpm check` falhar com um import de `vscode` fora da extensão e com um import de `node:http` dentro dela.

---

### P2: Guia para outro editor

**User Story**: Como contribuidor, quero um guia para acrescentar outro editor (JetBrains, Neovim), como já existe para linguagem e provedor.

**Acceptance Criteria**:

1. The repositório SHALL ter `docs/adicionar-editor.md`, que explica a embalagem (`apps/<id>`), o `createCore`, o `SettingsStore`, a ponte sem porta e as regras de segurança, e o README SHALL explicar como instalar o `.vsix`.  <!-- VSC-15 -->

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| VSC-01..08 | P1: Abrir o mapa dentro do VS Code | Pending |
| VSC-09..14 | P1 (segurança): A webview só fala com o núcleo | Pending |
| VSC-15 | P2: Guia para outro editor | Pending |
