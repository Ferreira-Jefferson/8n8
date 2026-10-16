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
| Digitar o caminho do `claude` num campo da tela | Um caminho vindo da API local seria um jeito de rodar qualquer programa: um defeito de XSS viraria execução de um `.exe` do próprio repositório analisado. O caminho vem do ambiente (`APP8N8_CLAUDE_PATH`), da janela de arquivo do sistema (CC-18) ou dos lugares de instalação conhecidos. |
| `--bare` | Ele lê só `ANTHROPIC_API_KEY` e ignora a assinatura (AD-022). |
| Streaming da resposta | O pipeline espera o texto inteiro para revisar (AD-008). |
| `vscode.lm` e outros agentes (Cursor, Codex) | Fora do uso do autor (AD-022). Ficam como ponto de extensão. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Id e modelo padrão | `claude-code`, modelo `claude-sonnet-5-5` | Medido em 2026-10-15: o alias `sonnet` do Claude Code 2.1.145 ainda é o 4.6, que levou de 24 a 74 s por rascunho; o Sonnet 5.5 levou de 3 a 15 s. O Haiku 5.5 com esforço baixo tem o mesmo tempo, e o Sonnet é o modelo mais forte. O campo Modelo aceita outro alias ou nome completo. | y |
| Pasta de trabalho do processo | Uma pasta vazia própria, `<tmp do sistema>/8n8-claude` | Em `-p` o Claude Code pula o diálogo de confiança da pasta. Na pasta analisada ele leria `.claude/settings.json`, hooks e `CLAUDE.md` de um código que pode ser de terceiros. | y |
| Configurações carregadas | Nenhum arquivo de configuração (`--setting-sources ""`), sem MCP (`--strict-mcp-config` sem `--mcp-config`), sem ferramentas (`--tools ""`), sem comandos de barra | O pedido só precisa de texto. Cada item a menos é uma porta a menos. Sem as configurações do usuário, os hooks e plugins dele não rodam, e a abertura cai de 7–9 s para 3–4 s. O login não mora nelas (testado em 2026-10-15). | y |
| Tempo e tamanho | 180 s por chamada; saída de no máximo 5 MB | Uma revisão leva de 2 a 6 chamadas (AD-008). Um processo preso não pode segurar o servidor. | y |
| Formato da entrada e da saída | `--input-format stream-json --output-format stream-json --verbose`; o texto vem em `result` da linha `type: "result"` | Em modo texto, o `claude -p` desiste se o stdin não chega logo, então não dá para abrir o processo antes. Em `stream-json` ele espera o pedido sem prazo. Testado em 2026-10-15 com o Claude Code 2.1.145. | y |
| Processos abertos antes | Até 2, um por modelo e prompt de sistema; o mais antigo fecha quando entra outro; fecha após 10 min sem uso | A API responde em ~1,2 s, mas abrir o `claude.exe` leva 3–4 s. Cada processo parado ocupa ~300 MB. Um processo responde um pedido só: ele guarda a conversa, e o pedido seguinte veria o nó anterior. | y |
| Esforço | `--effort low` | O Haiku 5.5 no esforço padrão gera ~2.400 tokens de raciocínio para ~800 caracteres de resposta (12 s); no baixo, 3,5–7 s. No Sonnet 5.5 o tempo não muda. | y |

**Open questions:** none.

---

## User Stories

### P1: Usar a assinatura do Claude Code ⭐ MVP

**User Story**: Como assinante do Claude Code, quero escolher o Claude Code como provedor de LLM, para ver resumos e sugestões sem criar chave de API.

**Why P1**: É o provedor que o autor usa todo dia.

**Acceptance Criteria**:

1. The registro de provedores SHALL ter `claude-code`, com modelo padrão `claude-sonnet-5-5`, e o diálogo de Configurações SHALL listá-lo. WHEN o provedor escolhido é `claude-code` THEN o diálogo SHALL esconder os campos de chave e de URL e mostrar "O Claude Code usa a sua assinatura. Não precisa de chave.".  <!-- CC-01 -->
2. The provedor SHALL achar o executável nesta ordem: `APP8N8_CLAUDE_PATH` (um arquivo que existe); o arquivo escolhido em Configurações (CC-18), se ainda existe; e, só quando `APP8N8_CLAUDE_PATH` não está definida, os lugares de instalação. No Windows: `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`, `~\.local\bin\claude.exe` (o instalador nativo) e, para cada pasta do `PATH`, o `claude.exe` dela e o `node_modules\@anthropic-ai\claude-code\bin\claude.exe` ao lado de um `claude.cmd` do npm (qualquer prefixo do npm, nvm, volta). Fora do Windows: o primeiro arquivo `claude` das pastas do `PATH`, depois `~/.local/bin/claude` e `~/.claude/local/claude`. IF nenhum existe THEN o provedor SHALL contar como não configurado, e o pedido SHALL responder `no-key`.  <!-- CC-02 -->
3. WHEN o pipeline faz uma chamada THEN o provedor SHALL rodar o executável sem shell, com os argumentos em lista: `-p --input-format stream-json --output-format stream-json --verbose --model <modelo> --effort low --system-prompt <prompt do sistema> --tools "" --no-session-persistence --setting-sources "" --strict-mcp-config --disable-slash-commands` (o `--system-prompt` só quando a conversa tem mensagem de sistema). O texto da conversa (o código do nó) SHALL ir pelo stdin, numa mensagem `user` de uma linha JSON, nunca como argumento. O argumento `--bare` nunca SHALL aparecer. IF o modelo começa com `-` THEN a chamada SHALL falhar antes de rodar o processo, e `PUT /api/settings` SHALL recusar um modelo que não é um id (letra, dígito ou `~` no início, depois só caracteres de id).  <!-- CC-03 -->
4. The processo SHALL rodar com a pasta de trabalho `<tmp do sistema>/8n8-claude`, criada vazia se não existe, e nunca na pasta analisada.  <!-- CC-04 -->
5. The ambiente do processo SHALL ser o ambiente do host sem as chaves dos outros provedores (`OPENROUTER_API_KEY`, `APP8N8_LLM_API_KEY`).  <!-- CC-05 -->
6. WHEN a saída traz uma linha JSON com `type: "result"` e `is_error: false` THEN a chamada SHALL devolver o campo `result` e encerrar o processo. IF o processo fecha antes dessa linha, ou ela traz `is_error: true` THEN a chamada SHALL falhar com uma mensagem curta ("O Claude Code falhou (código N).", "O Claude Code respondeu um formato desconhecido." ou "O Claude Code recusou o pedido: <subtipo>."), sem a saída bruta.  <!-- CC-06 -->
7. IF o processo passa de 180 s ou a saída passa de 5 MB THEN o provedor SHALL encerrar o processo e falhar com "O Claude Code não respondeu em 180 s." ou "O Claude Code respondeu demais.".  <!-- CC-07 -->
8. WHEN a conversa tem mais de uma mensagem além do sistema (o pedido de novo rascunho, FID-08) THEN o stdin SHALL levar as mensagens em ordem, a do modelo marcada com "Sua resposta anterior:" e a do usuário com "Pedido:".  <!-- CC-08 -->

9. WHEN o provedor faz uma chamada THEN ele SHALL abrir já o processo da próxima chamada do mesmo modelo e prompt de sistema, e a próxima chamada desse tipo SHALL usá-lo. The provedor SHALL manter no máximo 2 processos esperando: ao abrir um terceiro, SHALL encerrar o mais antigo. IF um processo espera 10 min sem pedido THEN o provedor SHALL encerrá-lo. IF o processo que espera já fechou THEN a chamada SHALL abrir outro. Cada processo SHALL responder um pedido só. O prazo de 180 s SHALL contar a partir do pedido, não da abertura.  <!-- CC-13 -->
10. The processo SHALL rodar sem arquivos de configuração (`--setting-sources ""`): os hooks e plugins do usuário não rodam, e o login da assinatura continua valendo.  <!-- CC-14 -->

**Independent Test**: com um `spawn` falso, uma chamada mostra os argumentos, o stdin, a pasta e o ambiente exatos, e chamadas seguidas mostram qual processo respondeu cada uma; com `APP8N8_CLAUDE_SMOKE=1`, um teste chama o Claude Code de verdade e recebe um JSON.

---

### P1 (segurança): Só este arquivo inicia o Claude Code

**User Story**: Como usuário, quero que só um arquivo revisado do 8n8 possa iniciar programas, para que um provedor novo ou uma mudança descuidada não abra uma porta.

**Why P1**: O DIST-23 da 07 já reservou esta exceção à feature 09.

**Acceptance Criteria**:

1. The regra `no-child-process` SHALL aceitar `packages/llm/src/claude-code.ts` como a segunda exceção do código que vai no pacote, ao lado de `apps/cli/src/open-browser.ts`, e o teste das guardas SHALL provar que outro arquivo de `packages/llm` que importa `node:child_process` faz o `pnpm check` falhar.  <!-- CC-09 -->
2. The varredura do código SHALL aceitar `child_process` em `claude-code.ts` e continuar recusando-o em qualquer outro arquivo, fora das linhas já fixadas do `links.ts`.  <!-- CC-10 -->
3. The `.github/CODEOWNERS` SHALL exigir o dono do projeto como revisor de `packages/llm/src/claude-code.ts`.  <!-- CC-11 -->
4. The caminho do executável nunca SHALL vir no corpo de uma requisição à API local: `PUT /api/settings` não tem campo para ele, e `POST /api/settings/claude-path` só aceita `{ "action": "pick" | "auto" }`.  <!-- CC-12 -->

**Independent Test**: `pnpm test` roda o teste das guardas com um arquivo de `packages/llm` que importa `node:child_process`, e o check falha.

---

### P1: Achar o Claude Code sem configurar

**User Story**: Como quem tem o Claude Code instalado, quero que o 8n8 o use sem eu configurar nada, e que a tela diga se achou, para eu saber que está tudo certo ou o que falta.

**Why P1**: O provedor sem chave só resolve o problema se a pessoa não precisar descobrir que ele existe.

**Acceptance Criteria**:

1. WHEN nem `APP8N8_LLM_PROVIDER` nem a config guardada escolhem um provedor THEN o provedor SHALL ser `claude-code` se o Claude Code é achado (CC-02), e `openrouter` se não. IF a config guarda uma chave ou um modelo sem provedor (um arquivo de antes desta regra) THEN eles SHALL continuar valendo para o `openrouter`. WHEN a tela salva uma chave ou um modelo sob o padrão `claude-code` THEN o servidor SHALL guardar também o provedor.  <!-- CC-15 -->
2. IF `APP8N8_CLAUDE_PATH` está definida e não aponta para um arquivo THEN o provedor SHALL usar o arquivo escolhido na tela, se houver, e SHALL NOT procurar nos lugares de instalação: quem define a variável diz "use este". Os testes usam isso para desligar a busca.  <!-- CC-16 -->
3. The `GET /api/settings` SHALL dizer onde está o Claude Code: `claude: { path, source, envInvalid }`, com `source` `env`, `picked`, `auto` ou `null`. WHEN o provedor do formulário é `claude-code` THEN Configurações SHALL mostrar, logo abaixo do provedor, em uma linha curta: "Claude Code encontrado." em verde, com o caminho em letra pequena; ou "O caminho em APP8N8_CLAUDE_PATH não tem o Claude Code. Escolha o executável."; ou "Claude Code não encontrado. Escolha o executável.". WHEN o provedor é `claude-code` e o Claude Code não é achado THEN o aviso do painel SHALL ser "O Claude Code não foi encontrado. Escolha o executável em Configurações.".  <!-- CC-17 -->
4. WHEN a pessoa clica "Escolher…" THEN a tela SHALL enviar `POST /api/settings/claude-path` com `{ "action": "pick" }`, e o servidor SHALL abrir a janela de arquivo do sistema (filtro "Claude Code", `*.exe` no Windows). IF o arquivo escolhido existe e se chama `claude` ou `claude.exe` THEN o servidor SHALL guardá-lo em `claudePath` na config e responder a nova vista; IF não THEN SHALL responder 400 `not-claude` e não guardar nada; IF a pessoa fecha a janela THEN nada muda. `{ "action": "auto" }` SHALL apagar o arquivo escolhido. O botão SHALL NOT aparecer quando uma `APP8N8_CLAUDE_PATH` válida define o caminho; "Usar o automático" SHALL aparecer só quando há arquivo escolhido.  <!-- CC-18 -->

**Independent Test**: com uma busca falsa, a vista diz o provedor padrão e a situação do Claude Code; com uma janela de arquivo falsa, a rota guarda só um `claude.exe` que existe; na tela real (e2e), uma `APP8N8_CLAUDE_PATH` errada mostra o aviso e o botão.

---

### P1 (robustez): Nenhum processo do Claude Code sobrevive ao 8n8

**User Story**: Como usuário, quero que fechar o 8n8 (o terminal da CLI ou o VS Code) encerre todos os processos do Claude Code que ele abriu, para não acumular processos soltos que gastam memória.

**Acceptance Criteria**:

1. WHEN o 8n8 é encerrado de forma bruta (como ao fechar o terminal) THEN todo processo do Claude Code que o provedor abriu SHALL terminar em até 10 s: cada um lê o stdin pelo cano do 8n8 e termina quando o cano fecha. The processo que respondeu um pedido SHALL terminar logo depois da resposta, e o de reserva SHALL terminar após `spareIdleMs` sem uso, com o 8n8 ainda rodando. The teste `packages/llm/src/__tests__/processes.test.ts` SHALL provar isso com processos reais em qualquer máquina, sem Claude Code nem login: um hospedeiro faz o papel do 8n8 com o provedor real, e `fixtures/fake-claude.mjs` faz o papel do Claude Code. Ele entra no `pnpm test` padrão, como exceção nomeada da regra `no-child-process` e do `CODEOWNERS`.  <!-- CC-19 -->

**Independent Test**: `pnpm test` mata o hospedeiro com `SIGKILL` e pergunta ao sistema (sinal 0) quais processos seguem vivos.

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| CC-01..08 | P1: Usar a assinatura do Claude Code | Verified |
| CC-13..14 | P1: Usar a assinatura do Claude Code | Verified |
| CC-09..12 | P1 (segurança): Só este arquivo inicia o Claude Code | Verified |
| CC-15..18 | P1: Achar o Claude Code sem configurar | Verified |
| CC-19 | P1 (robustez): Nenhum processo do Claude Code sobrevive ao 8n8 | Verified |
