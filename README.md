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

## Como rodar

Você precisa de Node 22.12 ou mais novo e do pnpm.

```bash
pnpm install
```

Para desenvolver, com recarga automática:

```bash
pnpm dev
```

Isso sobe o servidor (`pnpm dev:server`, porta 4317) e a tela (`pnpm dev:web`, com o Vite). Abra o endereço que o Vite mostrar no terminal.

Para usar sem recarga, construa a tela e suba tudo em um servidor só:

```bash
pnpm start
```

Abra `http://127.0.0.1:4317`. A porta muda com a variável `CODE2N8N_PORT`.

### A chave do LLM

Os resumos e as sugestões pedem um provedor de LLM. Copie `.env.example` para `.env` na raiz e preencha:

```bash
cp .env.example .env
```

- `CODE2N8N_LLM_PROVIDER`: `openrouter` (o padrão) ou `openai-compatible` (OpenAI, Ollama, LM Studio).
- `OPENROUTER_API_KEY`: a chave do provedor `openrouter`.
- `CODE2N8N_LLM_BASE_URL` e `CODE2N8N_LLM_API_KEY`: a URL e a chave do provedor `openai-compatible`. Em servidor local, a chave é opcional.
- `CODE2N8N_MODEL` e `CODE2N8N_REVIEW_MODEL`: o modelo do resumo e o do revisor. Vazio usa o padrão do provedor.

**Sem chave, o mapa funciona.** Só os textos (resumos e sugestões) ficam de fora. A estrutura não depende do LLM.

Para acrescentar um provedor, veja [docs/adicionar-provedor-llm.md](docs/adicionar-provedor-llm.md).

## Estrutura do repositório

| Pasta | O que tem |
|---|---|
| `apps/web` | A tela: React com React Flow. |
| `packages/model` | Os tipos e contratos: `Graph`, `LanguagePlugin`, `LlmClient`. |
| `packages/languages/*` | Um plugin por linguagem, mais `testkit` (suíte de conformidade) e `treesitter` (auxiliar de gramática). |
| `packages/project` | Monta o grafo do projeto e detecta a linguagem do trecho. |
| `packages/links` | Ligações entre linguagens por rota HTTP, processo e nome. |
| `packages/input` | Leitura de pasta. |
| `packages/explain` | Resumos e sugestões, com cache. |
| `packages/llm` | Provedores de LLM. |
| `packages/server` | O servidor da API. |
| `e2e` | Testes de ponta a ponta com Playwright. |
| `docs` | Guias e o manual da marca. |

## Como contribuir

Veja [CONTRIBUTING.md](CONTRIBUTING.md): ambiente, comandos de verificação, regras de fronteira entre pacotes e estilo de commit.

## Licença

O 8n8 é software livre, sob a GNU General Public License versão 3 (GPL-3.0). O texto completo está em [LICENSE](LICENSE).
