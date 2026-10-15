# CLI Specification

## Problem Statement

Hoje o 8n8 só roda de dentro do repositório, com `pnpm dev` ou `pnpm start`. O servidor lê o `.env` e grava o cache a partir da raiz do repositório. Para usar o 8n8 em qualquer projeto, o usuário precisa de um comando que abra o mapa de uma pasta no navegador, a partir do PowerShell ou do Bash. Isso exige separar o núcleo (o que o 8n8 faz) da embalagem (onde ele roda), como define a AD-022. A extensão do VS Code (feature 10) usa o mesmo núcleo.

Depende de: 02-pasta-local, 06-multilinguagem.

## Done When

Num PowerShell novo, numa pasta qualquer fora do repositório, o usuário roda `8n8 .` e o navegador abre com o mapa dessa pasta. O mesmo comando funciona no Git Bash.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Publicar no registro do npm | Ação externa e visível. Exige pedido explícito do usuário. A instalação nesta feature é local, pelo pacote gerado com `pnpm pack`. |
| Painel de configurações (chave, modelo padrão, resumo e sugestões automáticos ou por clique) | Feature 08. |
| Provedor Claude Code | Feature 09. |
| Extensão do VS Code | Feature 10. |
| `vscode.lm`, Cursor, Grok, JetBrains, Neovim, MCP | Fora do uso do autor (AD-022). Ficam como pontos de extensão para a comunidade. |
| Escolher outra porta sozinho quando a 4317 está ocupada | A mensagem de porta em uso e a variável `APP8N8_PORT` já resolvem. |
| Proteção de branch, CI obrigatório, CodeQL, Dependabot e `SECURITY.md` | Mexem nas configurações do GitHub, que são externas. Ficam numa feature de segurança do repositório, antes da abertura para a comunidade. Sem a proteção de branch, o `CODEOWNERS` (DIST-24) só aponta o revisor e não bloqueia o merge. |
| Atualizar o mapa quando os arquivos mudam | O usuário roda o comando de novo (igual à 02). |

**Deferred** (a fatia funciona sem estes itens):

- Observabilidade: log das requisições no terminal. Adiado: a CLI escreve só o endereço e os erros.
- Concorrência: dois `8n8` ao mesmo tempo. Adiado: o segundo cai na mensagem de porta em uso (DIST-06).
- Limpeza de dados: apagar cache e histórico antigos em `~/.8n8`. Adiado: o volume é pequeno.

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Nome do comando | `8n8` | É o nome do produto. Testado: o PowerShell e o Bash aceitam um comando que começa com número. | y |
| Pasta dos dados do usuário | `~/.8n8` (no Windows, `C:\Users\<nome>\.8n8`): cache em `~/.8n8/cache`, histórico em `~/.8n8/historico.db` | Um lugar só, fora do projeto analisado e fora da instalação. Não há histórico antigo para migrar: o `.cache/explain` do repositório não tem `historico.db`. | y |
| Config de LLM na CLI | Só por variáveis de ambiente nesta feature. A feature 08 cria `~/.8n8/config.json`, gravado pelo painel de configurações | Evita um `~/.8n8/.env` que viraria um segundo formato de config para sempre. | y |
| `pnpm dev` e `pnpm start` no repositório | Continuam lendo o `.env` da raiz do repositório, pela flag `--env-file-if-exists` do Node no script, sem código próprio para isso | Mantém o fluxo de desenvolvimento como está, sem um segundo caminho de config no código. | y |
| Forma de instalar | `pnpm pack` gera o pacote, e `npm install -g <arquivo .tgz>` instala | Não precisa de registro. A publicação no npm fica para depois. | y |
| Node mínimo da CLI | Node 22.13 | Primeira versão em que `node:sqlite` funciona sem flag (changelog oficial do módulo: v22.13.0 e v23.4.0). | y |
| Porta | 4317, trocada por `APP8N8_PORT` (igual a hoje) | Sem mudança de comportamento. | y |
| Abrir o navegador | Navegador padrão do sistema | O usuário trabalha com o navegador padrão. | y |

**Open questions:** none. Todas foram resolvidas ou registradas acima.

---

## User Stories

### P1: Abrir o mapa de uma pasta pela linha de comando ⭐ MVP

**User Story**: Como desenvolvedor, quero rodar `8n8 <pasta>` no PowerShell ou no Bash e ver o mapa da pasta no navegador, para entender um projeto sem abrir o repositório do 8n8.

**Why P1**: Sem isso o 8n8 só serve dentro do próprio repositório.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN o usuário roda `8n8 <pasta>` THEN o sistema SHALL subir o servidor em `127.0.0.1` e abrir o navegador padrão já com o mapa dessa pasta.  <!-- DIST-01 -->
2. WHEN o usuário roda `8n8` sem argumento THEN o sistema SHALL abrir o navegador na tela inicial, sem mapa aberto.  <!-- DIST-02 -->
3. WHEN o caminho da pasta é relativo THEN o sistema SHALL resolvê-lo a partir da pasta atual do terminal.  <!-- DIST-03 -->
4. The system SHALL aceitar o caminho com barra invertida (`C:\proj`) e com barra normal (`C:/proj`), no PowerShell e no Bash.  <!-- DIST-04 -->
5. IF a pasta não existe ou não é uma pasta THEN o sistema SHALL escrever "Pasta não encontrada: <caminho>" no terminal, sair com código 1 e não abrir o navegador.  <!-- DIST-05 -->
6. IF a porta já está em uso THEN o sistema SHALL escrever "A porta <porta> já está em uso. Feche o outro processo e tente de novo." e sair com código 1.  <!-- DIST-06 -->
7. The system SHALL escrever "8n8 em http://127.0.0.1:<porta>/#t=<token>" no terminal antes de abrir o navegador, para o usuário abrir o endereço à mão se o navegador não abrir.  <!-- DIST-07 -->
8. WHEN o usuário roda `8n8 --help` THEN o sistema SHALL escrever o uso (`8n8 [pasta]`, a opção `--no-open`, que sobe o servidor sem abrir o navegador, as variáveis `APP8N8_PORT`, `APP8N8_CACHE_DIR` e `APP8N8_HISTORY_DIR` e as variáveis de LLM do `.env.example`) e sair com código 0, sem subir o servidor.  <!-- DIST-08 -->
9. The system SHALL gravar o cache em `~/.8n8/cache` e o histórico em `~/.8n8/historico.db`, salvo quando `APP8N8_CACHE_DIR` ou `APP8N8_HISTORY_DIR` indicam outra pasta.  <!-- DIST-09 -->
10. The system SHALL nunca escrever na pasta analisada nem na pasta de instalação do pacote.  <!-- DIST-10 -->
11. IF não há config de LLM THEN o sistema SHALL abrir o mapa normalmente, e o painel de explicação SHALL mostrar o aviso de falta de chave que já existe.  <!-- DIST-11 -->
12. WHEN o pacote é instalado com `npm install -g` a partir do `.tgz` gerado por `pnpm pack` THEN o comando `8n8` SHALL rodar só com o Node, sem `tsx`, sem `pnpm` e sem nenhum arquivo do repositório.  <!-- DIST-12 -->
13. The pacote gerado por `pnpm pack` SHALL não declarar `dependencies` nem scripts de instalação (`preinstall`, `install`, `postinstall`), para que `npm install -g` não baixe nem rode código de terceiros. O código de terceiros vai embutido no build, nas versões travadas pelo `pnpm-lock.yaml`.  <!-- DIST-16 -->
14. The system SHALL nunca devolver ao navegador nem escrever no terminal o valor de uma chave de API.  <!-- DIST-17 -->

**Independent Test**: Gerar o pacote, instalar numa pasta global temporária, rodar `8n8 <fixture projeto-loja>` de outra pasta e ver o mapa no navegador com os nós da fixture.

---

### P1 (estrutura): Núcleo separado da embalagem

**User Story**: Como contribuidor, quero que o núcleo não saiba onde roda, para acrescentar um editor novo sem mexer no núcleo.

**Why P1**: É a condição da AD-022. A feature 10 (extensão) depende disso, e sem a separação a CLI nasceria com o núcleo amarrado ao repositório.

**Acceptance Criteria**:

1. The `server` package SHALL receber a config de LLM, as pastas de cache e de histórico, as regras de PTS e os plugins por parâmetro, e SHALL nunca ler `process.env`, abrir uma porta ou montar caminhos a partir da raiz do repositório.  <!-- DIST-13 -->
2. IF um pacote em `packages/` ou o app `apps/web` importa `apps/cli`, ou uma embalagem em `apps/` importa outra embalagem THEN `pnpm check` SHALL falhar.  <!-- DIST-14 -->
3. WHEN o usuário roda `pnpm dev` ou `pnpm start` no repositório THEN o script SHALL rodar a CLI (`apps/cli/src/main.ts` no `dev:server`, `apps/cli/dist/8n8.mjs` no `start`) com a flag `--env-file-if-exists=.env` do Node, que lê o `.env` da raiz quando ele existe e segue sem ele quando não existe.  <!-- DIST-15 -->

**Independent Test**: `pnpm check` falha com um import proibido de teste e passa sem ele; `pnpm test`, `pnpm typecheck` e `pnpm e2e` continuam verdes.

---

### P1 (segurança): Só o usuário usa os recursos dele

**User Story**: Como usuário, quero que nenhum site aberto no navegador e nenhum outro programa da máquina consiga usar a minha chave de API, a minha assinatura do Claude Code ou ler os meus arquivos pelo 8n8, para confiar na ferramenta.

**Why P1**: O servidor local dispara chamadas de LLM pagas com a chave do usuário. Sem estas proteções, qualquer processo que alcance a porta gasta os recursos dele. O projeto é aberto, então as proteções precisam de testes que falhem quando alguém as remove.

**Acceptance Criteria**:

1. WHEN a CLI sobe THEN o sistema SHALL gerar um token de sessão com 32 bytes aleatórios (`node:crypto`) e abrir o navegador com o token no fragmento da URL (`#t=<token>`), que o navegador não envia na requisição da página.  <!-- DIST-18 -->
2. WHEN a tela lê o token do fragmento THEN ela SHALL guardá-lo só em `sessionStorage`, tirá-lo da barra de endereço e enviá-lo no cabeçalho `x-8n8-token` em toda chamada a `/api/*`.  <!-- DIST-19 -->
3. IF uma requisição a `/api/*` chega sem o token ou com um token diferente THEN o sistema SHALL responder 401, sem ler arquivo, sem consultar o histórico e sem chamar o LLM. A comparação SHALL ser em tempo constante (`timingSafeEqual`).  <!-- DIST-20 -->
4. The suíte de segurança SHALL listar as rotas registradas no app e falhar quando existe uma rota em `/api/*` que ela não ataca com: Host estranho (403, regra da AD-007), POST sem JSON (415), sem token (401) e token errado (401). Em cada ataque, a suíte SHALL provar com um dublê que o LLM, a leitura de pasta e o histórico não foram chamados.  <!-- DIST-21 -->
5. The suíte de segurança SHALL subir o app com uma chave sentinela e falhar se o valor dela aparece no corpo ou nos cabeçalhos de qualquer resposta, ou na saída do terminal da CLI. Ela é a prova do DIST-17.  <!-- DIST-22 -->
6. IF um arquivo de `packages/` ou `apps/` (o código que vai no pacote) importa `node:child_process`, ou o código usa `eval`, `new Function` ou `dangerouslySetInnerHTML` THEN `pnpm check` SHALL falhar. A única exceção é `apps/cli/src/open-browser.ts`, que abre o navegador (design). As ferramentas de desenvolvimento em `scripts/` e os testes em `e2e/` ficam fora dessa regra. A feature 09 acrescenta só o provedor Claude Code como exceção.  <!-- DIST-23 -->
7. The repositório SHALL ter um arquivo `.github/CODEOWNERS` que exige o dono do projeto como revisor dos arquivos de segurança: as guardas do `server`, a suíte de segurança, `.dependency-cruiser.cjs`, `biome.json`, `pnpm-workspace.yaml`, `.githooks/`, `.gitleaks.toml` e o próprio `CODEOWNERS`.  <!-- DIST-24 -->

**Independent Test**: `pnpm test` roda a suíte de segurança e passa. Apagar uma guarda, registrar uma rota nova sem ataque na suíte ou importar `node:child_process` faz `pnpm test` ou `pnpm check` falhar.

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| DIST-01..12 | P1: Abrir o mapa de uma pasta pela linha de comando | Pending |
| DIST-16..17 | P1: Abrir o mapa de uma pasta pela linha de comando | Pending |
| DIST-13..15 | P1 (estrutura): Núcleo separado da embalagem | Pending |
| DIST-18..24 | P1 (segurança): Só o usuário usa os recursos dele | Pending |
