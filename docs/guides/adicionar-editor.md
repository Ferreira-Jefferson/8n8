# Adicionar um editor

O 8n8 tem um núcleo e várias embalagens (AD-022). O núcleo (`packages/server`) faz tudo: lê a pasta, monta o grafo, chama o LLM e guarda o histórico. Uma embalagem só decide onde o núcleo roda e como a tela fala com ele. Hoje há duas: a CLI (`apps/cli`) e a extensão do VS Code (`apps/editors/vscode`).

Este guia mostra como acrescentar outro editor, como JetBrains ou Neovim. Use `apps/editors/vscode` como modelo.

## O que a embalagem faz

Uma embalagem de editor mora em `apps/editors/<id>` (a CLI e a tela ficam direto em `apps/`). O `pnpm-workspace.yaml` já inclui `apps/editors/*`. Ela faz quatro coisas:

1. **Monta o núcleo** com `createCore` (`packages/server/src/core.ts`). O núcleo recebe tudo por parâmetro e nunca lê o ambiente sozinho:

   | Opção | O que a embalagem passa |
   |---|---|
   | `env` | O ambiente do processo. As variáveis `APP8N8_*` e as dos provedores valem como na CLI. |
   | `ptsRules` | O texto de `docs/writing-rules/portugues-tecnico-simplificado.md`, copiado para o pacote. |
   | `cacheDir`, `historyFile` | Onde o editor guarda os dados da extensão. |
   | `port` | A porta que a guarda de `Host` aceita. Sem servidor, qualquer número fixo serve, desde que a ponte use o mesmo. |
   | `token` | Um token aleatório de 32 bytes, gerado a cada ativação. |
   | `settings` | Um `SettingsStore` com `read` e `write`. |
   | `analysisWorker` | Opcional. O caminho do arquivo `analysis-worker.mjs`, que fica ao lado do `core.mjs`. Com ele, o núcleo monta o mapa da pasta em threads (`worker_threads`): uma thread de construção e as threads da análise, que são abertas a partir desse mesmo arquivo. A thread do pedido só guarda o resultado compacto e fica livre. Sem ele, a construção roda na thread do pedido. O build da embalagem gera esse arquivo a partir de `packages/server/src/analysis-worker.ts`. Não há outro arquivo de worker para embalar. |

2. **Guarda a config** num `SettingsStore`. A chave de API vai para o cofre do editor (no VS Code, o `SecretStorage`). O resto pode ir para o estado do editor. A chave nunca vai para um arquivo de texto quando o editor tem cofre.

3. **Mostra a tela.** A tela é o build de `apps/ui`, que usa caminhos relativos. A embalagem serve esse build num painel do editor.

4. **Liga a tela ao núcleo.** Prefira uma ponte sem porta, como a do VS Code: a página manda mensagens, e a embalagem transforma cada uma num `Request` e chama `app.fetch`. A ponte:
   - aceita só `GET`, `POST`, `PUT` e `DELETE` em caminhos `/api/...`, sem `..`, `//`, `\` ou esquema;
   - põe ela mesma o cabeçalho `Host` e o token, para a página nunca ver o token;
   - responde 400 a qualquer outra mensagem, sem chamar o núcleo.

   A tela já sabe falar com uma ponte: com `<meta name="8n8-host" content="vscode">` na página, `apps/ui/src/api.ts` manda cada chamada por `postMessage`. Um editor novo pode usar o mesmo formato de mensagem (`apps/ui/src/vscode-host.ts`) ou acrescentar um transporte ao lado dele.

## As regras de segurança

O `pnpm check` e o teste das guardas (`apps/cli/src/__tests__/guards.test.ts`) garantem estas regras:

- Uma embalagem não importa outra (`hosts-do-not-import-each-other`). Código comum vai para um pacote em `packages/`.
- O núcleo e a tela não importam o módulo do editor (`only-vscode-host-imports-vscode`, no caso do VS Code). Um editor novo ganha uma regra igual.
- A extensão do VS Code não abre porta (`vscode-opens-no-port`). Se o seu editor precisar de servidor, ouça só em `127.0.0.1` e exija o token, como a CLI faz.
- Nenhum arquivo inicia processos, fora das exceções nomeadas na regra `no-child-process`.
- A página do painel tem uma CSP estrita: scripts só com nonce, nenhuma conexão de rede (`connect-src 'none'`).

Toda regra nova entra também no teste das guardas, com um arquivo que a viola, e os arquivos da ponte e da página entram no `.github/CODEOWNERS`.

## Os testes

- Testes unitários (Vitest) para os módulos que não dependem do editor: a ponte, o HTML do painel, o `SettingsStore`.
- Um teste de integração que abre o editor de verdade, roda o comando e confere que a página carregou e que a ponte respondeu ao mapa. No VS Code ele roda com `pnpm --filter 8n8-vscode test:integration`.

## Checklist

1. Crie `apps/editors/<id>` com o manifesto do editor e um build que empacota o núcleo, as gramáticas, a tela e as regras de PTS.
2. Implemente o `SettingsStore` com o cofre do editor.
3. Implemente a ponte e o painel com a CSP.
4. Acrescente as regras do editor ao `.dependency-cruiser.cjs` e ao teste das guardas.
5. Escreva os testes unitários e o de integração.
6. Rode `pnpm typecheck`, `pnpm check` e `pnpm test`.
