# 8n8

O 8n8 recebe código (um arquivo, uma pasta ou um trecho) e mostra como ele se conecta, como nós e fios no estilo n8n. A visão começa ampla. Você abre um nó para ver o fluxo interno dele e vai descendo até as linhas reais de código. Cada nó tem um resumo e sugestões de melhoria.

O 8n8 não migra nada para o n8n. Do n8n vem só o modelo mental.

O objetivo é supervisionar e entender rápido um código, muitas vezes escrito por IA, sem ler linha por linha.

## Como funciona

- Há um grafo hierárquico: repositório, módulo, arquivo, função, bloco. A tela o desenha como fluxo de nós e fios.
- A estrutura vem de parsing determinístico (Tree-sitter). O LLM nunca decide a estrutura. Ele só escreve resumos e sugestões, sempre presos a um nó e a uma linha.
- Todo nó leva de volta ao código real (arquivo e linhas).
- Os textos usam Português Técnico Simplificado: frases curtas, voz ativa, um termo por conceito. As regras estão em [docs/portugues-tecnico-simplificado.md](docs/portugues-tecnico-simplificado.md).

## Linguagens suportadas

| Linguagem | Extensões | Pacote |
|---|---|---|
| Python | `.py` | `packages/languages/python` |
| TypeScript | `.ts`, `.tsx` | `packages/languages/typescript` |

Uma pasta com as duas linguagens vira um mapa só. Os arquivos se ligam por rota HTTP, por processo e por nome.

Para acoplar outra linguagem, siga o guia [docs/adicionar-linguagem.md](docs/adicionar-linguagem.md).

## O que o 8n8 lê de uma pasta

O 8n8 respeita o `.gitignore` da pasta. Ele lê o `.gitignore` da raiz e o de cada subpasta, com as regras do git (padrões, `!`, `/` e `**`). Um arquivo que o `.gitignore` ignora não entra no mapa nem aparece na lista de arquivos ignorados. O `.gitignore` global da máquina e o `.git/info/exclude` não contam: o mapa da mesma pasta é igual em qualquer máquina.

O 8n8 também pula, sempre:

- as pastas `.git`, `node_modules`, `build` e `dist`;
- as pastas de cada linguagem: `.venv`, `venv`, `__pycache__` e `site-packages` (Python), `.next` e `coverage` (TypeScript);
- arquivos de extensão que nenhuma linguagem lê.

Alguns arquivos de código ficam fora do mapa por outro motivo: maior que 1 MB, fora do UTF-8, ilegível ou link simbólico. Nesse caso, um ícone de aviso aparece no canto do mapa. O hover diz quantos arquivos ficaram fora, e o clique mostra a lista com o motivo de cada um. Um arquivo maior que 1 MB, e de até 20 MB, tem o botão "Adicionar ao mapa".

O histórico guarda só o caminho de cada pasta, nunca o código. Abrir uma pasta pelo histórico lê a pasta de novo. De um trecho colado, o histórico guarda o texto e a linguagem.

## Como rodar

Você precisa de Node 22.13 ou mais novo e do pnpm.

```bash
pnpm install
```

Para desenvolver, com recarga automática:

```bash
pnpm dev
```

Isso sobe o servidor (`pnpm dev:server`, porta 4317) e a tela (`pnpm dev:web`, com o Vite). Abra o endereço que o Vite mostrar no terminal.

Para usar sem recarga, construa a CLI e suba tudo em um servidor só:

```bash
pnpm start
```

Abra o endereço que o terminal mostrar (`http://127.0.0.1:4317/#t=...`). O `#t=` é o token da sessão: sem ele, a API responde 401. A porta muda com a variável `APP8N8_PORT`.

### O comando `8n8`

A CLI abre o mapa de qualquer pasta, no PowerShell ou no Bash. Ela precisa de Node 22.13 ou mais novo. Para instalar a partir do repositório:

```bash
pnpm --filter @8n8/cli build
pnpm --filter @8n8/cli pack
npm install -g ./apps/cli/8n8-cli-0.0.1.tgz
```

O pacote não tem dependências nem scripts de instalação: todo o código vai dentro dele.

```bash
8n8 .              # abre o mapa da pasta atual no navegador
8n8 C:\projeto     # ou de qualquer pasta
8n8                # abre a tela inicial
8n8 --no-open      # sobe o servidor sem abrir o navegador
8n8 --help         # mostra o uso e as variáveis
```

Cada execução gera um token novo, que só a aba aberta pela CLI conhece. Outro programa da máquina não consegue usar a API nem a sua chave de LLM.

Os dados ficam em `~/.8n8` (no Windows, `C:\Users\<nome>\.8n8`): o cache em `cache/`, o histórico em `historico.db` e as configurações em `config.json`. As variáveis `APP8N8_CACHE_DIR`, `APP8N8_HISTORY_DIR` e `APP8N8_CONFIG_DIR` mudam essas pastas. A CLI instalada nunca lê um `.env`.

### A chave do LLM

Os resumos e as sugestões pedem um provedor de LLM. O jeito mais simples é pela tela: clique no botão **Configurações** (no canto de cima, em todas as telas) e preencha:

- **Provedor**: `openrouter` (o padrão), `openai-compatible` (OpenAI, Ollama, LM Studio) ou `claude-code` (a sua assinatura do Claude Code, sem chave).
- **Chave de API**: o campo só recebe a chave. Ela nunca volta para a tela: o diálogo diz só "Chave guardada".
- **URL** e **Modelo**: vazios usam o padrão do provedor.
- **Gerar o resumo ao selecionar um nó** e **Pedir as sugestões ao selecionar um nó**: desligados, o resumo e as sugestões só são pedidos quando você clica em "Gerar resumo" ou "Pedir sugestões". Assim nada é gasto enquanto você só navega. O que já está no cache aparece sem clique.

A CLI guarda isso em `~/.8n8/config.json`, só com permissão do dono. Trocar o provedor ou a URL apaga a chave guardada, para a chave nunca ir a um servidor que você não escolheu.

Uma variável de ambiente ganha da tela, e o campo dela aparece travado no diálogo. No repositório, `pnpm dev` e `pnpm start` leem o `.env` da raiz. Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

- `APP8N8_LLM_PROVIDER`: `openrouter` (o padrão), `openai-compatible` (OpenAI, Ollama, LM Studio) ou `claude-code`.
- `APP8N8_CLAUDE_PATH`: o caminho do executável do Claude Code, quando ele não está no lugar de instalação padrão. O caminho só vem desta variável, nunca da tela.
- `OPENROUTER_API_KEY`: a chave do provedor `openrouter`.
- `APP8N8_LLM_BASE_URL` e `APP8N8_LLM_API_KEY`: a URL e a chave do provedor `openai-compatible`. Em servidor local, a chave é opcional.
- `APP8N8_MODEL` e `APP8N8_REVIEW_MODEL`: o modelo do resumo e o do revisor. Vazio usa o padrão do provedor.
- `APP8N8_AUTO_SUMMARY` e `APP8N8_AUTO_SUGGESTIONS`: `1` pede o resumo ou as sugestões ao selecionar um nó; `0` espera o clique.

**Sem chave, o mapa funciona.** Só os textos (resumos e sugestões) ficam de fora. A estrutura não depende do LLM.

Com o `claude-code`, o 8n8 roda o seu Claude Code em modo não interativo, numa pasta vazia própria, sem ferramentas, sem MCP e só com as suas configurações de usuário. O código do nó vai pelo stdin. Ele nunca roda dentro da pasta analisada, então os hooks e o `CLAUDE.md` dela não são carregados.

Para acrescentar um provedor, veja [docs/adicionar-provedor-llm.md](docs/adicionar-provedor-llm.md).

### A extensão do VS Code

A extensão abre o mesmo mapa num painel ao lado do código. Ela precisa do VS Code 1.138 ou mais novo. Para instalar a partir do repositório:

```bash
pnpm install
pnpm --filter 8n8-vscode package
code --install-extension apps/vscode/8n8-vscode-0.0.1.vsix
```

Depois, com uma pasta aberta, rode **8n8: Abrir mapa** na paleta de comandos. Para mapear uma subpasta, clique nela com o botão direito no Explorer e escolha **8n8: Abrir mapa desta pasta**.

A extensão não abre porta: a página do painel fala com o núcleo por mensagens do próprio VS Code, e nenhum outro programa da máquina alcança a API. A chave de API fica no cofre do VS Code (`SecretStorage`). O cache e o histórico ficam na pasta de dados da extensão. As variáveis de ambiente valem como na CLI.

Para acrescentar outro editor, veja [docs/adicionar-editor.md](docs/adicionar-editor.md).

## Estrutura do repositório

| Pasta | O que tem |
|---|---|
| `apps/web` | A tela: React com React Flow. |
| `apps/cli` | A CLI `8n8`, que abre a tela no navegador. |
| `apps/vscode` | A extensão do VS Code, que abre a tela num painel. |
| `packages/model` | Os tipos e contratos: `Graph`, `LanguagePlugin`, `LlmClient`. |
| `packages/languages/*` | Um plugin por linguagem, mais `testkit` (suíte de conformidade) e `treesitter` (auxiliar de gramática). |
| `packages/project` | Monta o grafo do projeto e detecta a linguagem do trecho. |
| `packages/links` | Ligações entre linguagens por rota HTTP, processo e nome. |
| `packages/input` | Leitura de pasta. |
| `packages/explain` | Resumos e sugestões, com cache. |
| `packages/llm` | Provedores de LLM. |
| `packages/server` | O núcleo: as rotas da API, montadas por `createCore`. |
| `e2e` | Testes de ponta a ponta com Playwright. |
| `docs` | Guias e o manual da marca. |

## Como contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md): ambiente, segredos (o hook do gitleaks), comandos de verificação, regras de fronteira entre pacotes e estilo de commit.

## Licença

O 8n8 é software livre, sob a GNU General Public License versão 3 (GPL-3.0). O texto completo está em [LICENSE](LICENSE).
