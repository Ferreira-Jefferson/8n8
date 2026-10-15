# Provedor Claude Code Specification

## Problem Statement

Quem já assina o Claude Code não tem uma chave de API do OpenRouter, e não deveria precisar de uma para ver resumos e sugestões. A AD-022 decide que o 8n8 usa o que a pessoa já tem: o Claude Code dela, em modo não interativo. O teste da AD-022 mostrou que o Node não acha o `claude` pelo nome no Windows (ele é um atalho `.cmd`), e que a chamada direta ao `claude.exe` com o prompt pelo stdin funciona com a assinatura do usuário.

Rodar um programa externo abre riscos que um pedido HTTP não abre: argumentos montados por shell, configurações e hooks da pasta analisada (que pode ser código de terceiros), um processo que não termina. Esta feature acrescenta o provedor fechando esses riscos.

Depende de: 08-config-llm-sob-demanda.

## Done When

No diálogo de Configurações, o usuário escolhe o provedor `claude-code`, salva e clica em "Gerar resumo". O resumo chega pela assinatura do Claude Code dele, sem chave nenhuma.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Escolher o caminho do `claude` pela tela | Um caminho vindo da API local seria um jeito de rodar qualquer programa. O caminho vem só do ambiente (`APP8N8_CLAUDE_PATH`) ou dos lugares de instalação conhecidos. |
| `--bare` | Ele lê só `ANTHROPIC_API_KEY` e ignora a assinatura (AD-022). |
| Streaming da resposta | O pipeline espera o texto inteiro para revisar (AD-008). |
| `vscode.lm` e outros agentes (Cursor, Codex) | Fora do uso do autor (AD-022). Ficam como ponto de extensão. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Id e modelo padrão | `claude-code`, modelo `sonnet` (alias que o Claude Code resolve) | O alias acompanha o modelo mais novo. O campo Modelo aceita `opus`, `haiku` ou o nome completo. | y |
| Pasta de trabalho do processo | Uma pasta vazia própria, `<tmp do sistema>/8n8-claude` | Em `-p` o Claude Code pula o diálogo de confiança da pasta. Na pasta analisada ele leria `.claude/settings.json`, hooks e `CLAUDE.md` de um código que pode ser de terceiros. | y |
| Configurações carregadas | Só as do usuário (`--setting-sources user`), sem MCP (`--strict-mcp-config` sem `--mcp-config`), sem ferramentas (`--tools ""`), sem comandos de barra | O pedido só precisa de texto. Cada item a menos é uma porta a menos. | y |
| Tempo e tamanho | 180 s por chamada; saída de no máximo 5 MB | Uma revisão leva de 2 a 6 chamadas (AD-008). Um processo preso não pode segurar o servidor. | y |
| Formato da saída | `--output-format json`; o texto vem em `result` | Testado em 2026-10-15 com o Claude Code 2.1.145: `{"type":"result","is_error":false,"result":"..."}`. | y |

**Open questions:** none.

---

## User Stories

### P1: Usar a assinatura do Claude Code ⭐ MVP

**User Story**: Como assinante do Claude Code, quero escolher o Claude Code como provedor de LLM, para ver resumos e sugestões sem criar chave de API.

**Why P1**: É o provedor que o autor usa todo dia.

**Acceptance Criteria**:

1. The registro de provedores SHALL ter `claude-code`, com modelo padrão `sonnet`, e o diálogo de Configurações SHALL listá-lo. WHEN o provedor escolhido é `claude-code` THEN o diálogo SHALL esconder os campos de chave e de URL e mostrar "O Claude Code usa a sua assinatura. Não precisa de chave.".  <!-- CC-01 -->
2. The provedor SHALL achar o executável nesta ordem: `APP8N8_CLAUDE_PATH` (um arquivo que existe); no Windows, `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`; fora do Windows, o primeiro arquivo `claude` das pastas do `PATH`, depois `~/.local/bin/claude` e `~/.claude/local/claude`. IF nenhum existe THEN o provedor SHALL contar como não configurado, e o pedido SHALL responder `no-key`.  <!-- CC-02 -->
3. WHEN o pipeline faz uma chamada THEN o provedor SHALL rodar o executável sem shell, com os argumentos em lista: `-p --output-format json --model <modelo> --system-prompt <prompt do sistema> --tools "" --no-session-persistence --setting-sources user --strict-mcp-config --disable-slash-commands`. O texto da conversa (o código do nó) SHALL ir pelo stdin, nunca como argumento. O argumento `--bare` nunca SHALL aparecer.  <!-- CC-03 -->
4. The processo SHALL rodar com a pasta de trabalho `<tmp do sistema>/8n8-claude`, criada vazia se não existe, e nunca na pasta analisada.  <!-- CC-04 -->
5. The ambiente do processo SHALL ser o ambiente do host sem as chaves dos outros provedores (`OPENROUTER_API_KEY`, `APP8N8_LLM_API_KEY`).  <!-- CC-05 -->
6. WHEN o processo termina com código 0 e a saída é um JSON com `is_error: false` THEN a chamada SHALL devolver o campo `result`. IF o código não é 0, o JSON é inválido ou `is_error` é `true` THEN a chamada SHALL falhar com uma mensagem curta ("O Claude Code falhou (código N).", "O Claude Code respondeu um formato desconhecido." ou "O Claude Code recusou o pedido: <subtipo>."), sem a saída bruta.  <!-- CC-06 -->
7. IF o processo passa de 180 s ou a saída passa de 5 MB THEN o provedor SHALL encerrar o processo e falhar com "O Claude Code não respondeu em 180 s." ou "O Claude Code respondeu demais.".  <!-- CC-07 -->
8. WHEN a conversa tem mais de uma mensagem além do sistema (o pedido de novo rascunho, FID-08) THEN o stdin SHALL levar as mensagens em ordem, a do modelo marcada com "Sua resposta anterior:" e a do usuário com "Pedido:".  <!-- CC-08 -->

**Independent Test**: com um `spawn` falso, uma chamada mostra os argumentos, o stdin, a pasta e o ambiente exatos; com `APP8N8_CLAUDE_SMOKE=1`, um teste chama o Claude Code de verdade e recebe um JSON.

---

### P1 (segurança): Só este arquivo inicia o Claude Code

**User Story**: Como usuário, quero que só um arquivo revisado do 8n8 possa iniciar programas, para que um provedor novo ou uma mudança descuidada não abra uma porta.

**Why P1**: O DIST-23 da 07 já reservou esta exceção à feature 09.

**Acceptance Criteria**:

1. The regra `no-child-process` SHALL aceitar `packages/llm/src/claude-code.ts` como a segunda exceção do código que vai no pacote, ao lado de `apps/cli/src/open-browser.ts`, e o teste das guardas SHALL provar que outro arquivo de `packages/llm` que importa `node:child_process` faz o `pnpm check` falhar.  <!-- CC-09 -->
2. The varredura do código SHALL aceitar `child_process` em `claude-code.ts` e continuar recusando-o em qualquer outro arquivo, fora das linhas já fixadas do `links.ts`.  <!-- CC-10 -->
3. The `.github/CODEOWNERS` SHALL exigir o dono do projeto como revisor de `packages/llm/src/claude-code.ts`.  <!-- CC-11 -->
4. The caminho do executável nunca SHALL vir da API local: `PUT /api/settings` não tem campo para ele.  <!-- CC-12 -->

**Independent Test**: `pnpm test` roda o teste das guardas com um arquivo de `packages/llm` que importa `node:child_process`, e o check falha.

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| CC-01..08 | P1: Usar a assinatura do Claude Code | Pending |
| CC-09..12 | P1 (segurança): Só este arquivo inicia o Claude Code | Pending |
