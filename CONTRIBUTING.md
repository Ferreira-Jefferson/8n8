# Contribuir com o 8n8

Obrigado por querer ajudar. Este guia mostra como preparar o ambiente, como verificar uma mudança e quais regras o projeto segue.

## Ambiente

- Node 22.12 ou mais novo (`engines` do `package.json`).
- pnpm (o `package.json` fixa a versão em `packageManager`).

```bash
pnpm install
pnpm dev
```

O [README](README.md) explica como rodar o app e como configurar a chave do LLM. Sem chave, o mapa funciona.

## Verificação

Toda mudança precisa de verificação antes do commit.

| Comando | O que faz |
|---|---|
| `pnpm test` | Roda os testes unitários de todos os pacotes (Vitest). |
| `pnpm typecheck` | Roda o TypeScript em todos os pacotes e em `e2e`. |
| `pnpm check` | Roda o Biome (estilo) e o dependency-cruiser (fronteiras). |
| `pnpm e2e` | Roda os testes de ponta a ponta (Playwright). |

Durante o trabalho, rode só o teste ligado à mudança. Por exemplo, `pnpm e2e e2e/<spec>.e2e.ts`. Rode a suíte inteira uma vez, antes do commit.

### Nota do Windows: `pnpm e2e` não termina

No Windows, o Playwright encerra os servidores de teste com o comando `taskkill`. Se a pasta `C:\Windows\System32` não está no `PATH` do seu shell, o `taskkill` não é encontrado. Os testes passam, mas o `pnpm e2e` não termina, e a execução seguinte falha com "is already used" nas portas 4317 a 4320.

Inclua `System32` no `PATH`. Num shell Bash, por exemplo:

```bash
PATH="$PATH:/c/Windows/System32:/c/Windows" pnpm e2e
```

Se já há servidores presos, encerre o processo `playwright test` antigo e os filhos dele.

## Regras de fronteira entre pacotes

Cada pacote exporta só `"."` (o `src/index.ts`). O `dependency-cruiser` confere as regras de `.dependency-cruiser.cjs` no `pnpm check`. As principais:

- Sem ciclos de import.
- `model` não importa nenhum pacote do workspace.
- Um plugin de linguagem importa só `model`, `lang-testkit` e `lang-treesitter`. Ele nunca importa outro plugin.
- `project`, `input`, `links`, `explain` e `llm` importam só `model`.
- `explain` não importa `llm`: ele conhece só o contrato `LlmClient` do `model`.
- `apps/web` importa só `model`.
- `model` e `apps/web` não usam módulos do Node (`node:*`).
- Um caminho relativo não sai da pasta do pacote.

Um import que cruza uma fronteira falha no `pnpm check`.

## A regra central

A estrutura do grafo vem de parsing determinístico (Tree-sitter). O LLM nunca decide a estrutura. Ele só escreve resumos e sugestões, sempre apontando o nó e a linha de origem (AD-001). O mesmo código gera o mesmo grafo. Uma mudança que põe um LLM no caminho da estrutura não entra.

## Acrescentar uma linguagem

Uma linguagem é um plugin em `packages/languages/<id>`. Siga o guia [docs/adicionar-linguagem.md](docs/adicionar-linguagem.md). O plugin precisa passar na suíte de conformidade (`describeLanguagePlugin`).

## Acrescentar um provedor de LLM

Um provedor é um arquivo em `packages/llm`. Siga o guia [docs/adicionar-provedor-llm.md](docs/adicionar-provedor-llm.md).

## Estilo de commit

Os commits seguem o formato `tipo(escopo): descrição`, em inglês, no imperativo e em minúsculas. O escopo é opcional. Exemplos do histórico:

```text
feat(history): star saved maps as favourites
refactor(treesitter): make the python and typescript plugins use lang-treesitter
docs(brand): give the inspiration its own heading and rewrite it
test(typescript): run the conformance suite on the TypeScript plugin
```

Os tipos em uso: `feat`, `fix`, `refactor`, `test`, `docs`, `chore` e `merge`. Faça commits pequenos, um assunto por commit.

## Textos para humanos

Os resumos, as sugestões e a documentação usam Português Técnico Simplificado: frases curtas, voz ativa, um termo por conceito. Veja [docs/portugues-tecnico-simplificado.md](docs/portugues-tecnico-simplificado.md).

## Licença

Ao contribuir, você concorda que o seu código fica sob a licença do projeto, a GNU General Public License versão 3 ([LICENSE](LICENSE)).
