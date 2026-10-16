# Contribuir com o 8n8

Obrigado por querer ajudar. Este guia mostra como preparar o ambiente, como verificar uma mudança e quais regras o projeto segue.

## Ambiente

- Node 22.13 ou mais novo: o histórico usa o `node:sqlite`, que funciona sem flag a partir dessa versão.
- pnpm (o `package.json` fixa a versão em `packageManager`).
- [gitleaks](https://github.com/gitleaks/gitleaks), que procura chaves e senhas antes de cada commit (veja "Segredos").

```bash
pnpm install
pnpm dev
```

O [README](README.md) explica como rodar o app e como configurar a chave do LLM. Sem chave, o mapa funciona.

## Segredos

O 8n8 lida com a chave de API e com a assinatura de LLM de quem usa. Uma chave no repositório deixa qualquer pessoa gastar os recursos de outra. Por isso, nenhum commit leva chave de API, token ou senha, nem em teste, fixture, documentação ou exemplo.

O `pnpm install` liga a pasta `.githooks`. O hook `pre-commit` roda o gitleaks no que está staged e bloqueia o commit quando acha um segredo. Ele também bloqueia o commit quando o gitleaks não está instalado.

Instale o gitleaks uma vez e abra um terminal novo:

| Sistema | Comando |
|---|---|
| Windows | `winget install Gitleaks.Gitleaks` |
| macOS | `brew install gitleaks` |
| Linux | veja a [instalação do gitleaks](https://github.com/gitleaks/gitleaks#installing) |

As regras ficam em [.gitleaks.toml](.gitleaks.toml): as regras padrão do gitleaks, mais uma para chaves do OpenRouter, que o padrão não cobre. Um provedor de LLM novo com formato próprio de chave ganha uma regra nesse arquivo.

- Em teste, use uma chave falsa e óbvia, como `e2e-fake-key`.
- Nunca pule o hook com `git commit --no-verify`.
- Se um segredo entrar num commit, revogue a chave no provedor. Apagar num commit novo não basta: ela continua no histórico.

Você pode usar o mesmo hook nos seus projetos: copie `.githooks/pre-commit` e rode `git config core.hooksPath .githooks`.

## Comandos

Todos os comandos rodam na raiz do repositório.

| Comando | O que faz |
|---|---|
| `pnpm install` | Instala as dependências de todos os pacotes. Também liga a pasta `.githooks`. |
| `pnpm dev` | Inicia o servidor (porta 8148) e a tela (Vite). Os dois recarregam quando você muda o código. |
| `pnpm dev:server` | Inicia só o servidor, sem abrir o navegador. |
| `pnpm dev:ui` | Inicia só a tela, com o Vite. |
| `pnpm start` | Constrói a tela e inicia o servidor e a tela juntos, sem recarga. Não abre o navegador. |
| `pnpm open <pasta>` | Constrói o CLI e abre o mapa da pasta. Uma pasta relativa vale a partir de onde você digitou o comando. |
| `pnpm build:cli` | Gera o pacote do CLI em `release/8n8-0.0.1.tgz`. |
| `pnpm build:ext` | Gera o pacote da extensão em `release/8n8-vscode-0.0.1.vsix`. |
| `pnpm build:all` | Instala as dependências e gera o CLI e a extensão. |
| `pnpm install:cli:global` | Gera o CLI e instala o comando `8n8` no terminal. |
| `pnpm prints` | Constrói o CLI e refaz as imagens do README em `docs/images`. |
| `pnpm test` | Roda os testes unitários (Vitest) de todos os pacotes. |
| `pnpm typecheck` | Roda o TypeScript em todos os pacotes e em `e2e`. |
| `pnpm check` | Roda o Biome (estilo) e o dependency-cruiser (fronteiras). |
| `pnpm e2e` | Constrói o CLI e roda os testes de ponta a ponta (Playwright). `E2E_WORKERS` muda o número de workers. |
| `pnpm verify` | Roda só o que a mudança afeta: unitários, typecheck e e2e (`--plan` só mostra o plano). |
| `pnpm e2e:map` | Refaz o mapa de cobertura dos e2e, que o `pnpm verify` usa. |
| `pnpm --filter 8n8-vscode test:integration` | Constrói a extensão e roda o teste dela num VS Code de verdade. Usa o VS Code instalado ou baixa um. |

## Verificação

Toda mudança precisa de verificação antes do commit. Rode `pnpm verify`: ele roda o `pnpm check` e, só nos pacotes e specs que a mudança afeta, os unitários, o typecheck e os e2e. O `pnpm verify --plan` mostra o que vai rodar e por quê.

Os e2e afetados vêm de um mapa de cobertura versionado (`e2e/coverage-map.json`): para cada spec, as funções de `src/` que ele executa e as regras de CSS que a tela dele usa. Uma linha alterada dentro de uma função roda só os specs que executaram essa função. Uma linha fora de função (import, constante) roda os specs que usam o arquivo. O que o mapa não explica roda todos os specs.

O mapa chega com o `git pull`. Quando o `pnpm verify` avisar que ele está velho, ou depois de criar um spec, rode `pnpm e2e:map` (uns 8 minutos) e commite o arquivo. Um spec que o mapa ainda não conhece roda sempre. Um mapa velho nunca deixa de rodar um spec por linha errada: o `verify` compara o código com o commit em que o mapa foi feito.

Num pull request e em push na `main`, a CI (`.github/workflows/ci.yml`) roda a suíte inteira e o gitleaks sobre todo o histórico. Veja também o [SECURITY.md](SECURITY.md).

Durante o trabalho, rode só o teste ligado à mudança. Por exemplo, `pnpm e2e e2e/<spec>.e2e.ts`.

Cada execução dos e2e sorteia uma faixa de portas livres entre 20000 e 59999. Duas execuções ao mesmo tempo, ou o app na 8148, não se esbarram. O `.cache` e o `apps/cli/dist` continuam sendo da pasta: para rodar testes em paralelo, use um git worktree por tarefa.

### Nota do Windows: `pnpm e2e` não termina

No Windows, o Playwright encerra os servidores de teste com o comando `taskkill`. Se a pasta `C:\Windows\System32` não está no `PATH` do seu shell, o `taskkill` não é encontrado. Os testes passam, mas o `pnpm e2e` não termina, e os servidores de teste ficam abertos.

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
- `apps/ui` importa só `model`.
- `model` e `apps/ui` não usam módulos do Node (`node:*`).
- Um caminho relativo não sai da pasta do pacote.

Um import que cruza uma fronteira falha no `pnpm check`.

## A regra central

A estrutura do grafo vem de parsing determinístico (Tree-sitter). O LLM nunca decide a estrutura. Ele só escreve resumos e sugestões, sempre apontando o nó e a linha de origem (AD-001). O mesmo código gera o mesmo grafo. Uma mudança que põe um LLM no caminho da estrutura não entra.

## Acrescentar uma linguagem

Uma linguagem é um plugin em `packages/languages/<id>`. Siga o guia [docs/guides/adicionar-linguagem.md](docs/guides/adicionar-linguagem.md). O plugin precisa passar na suíte de conformidade (`describeLanguagePlugin`).

## Acrescentar um provedor de LLM

Um provedor é um arquivo em `packages/llm`. Siga o guia [docs/guides/adicionar-provedor-llm.md](docs/guides/adicionar-provedor-llm.md).

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

Os resumos, as sugestões e a documentação usam Português Técnico Simplificado: frases curtas, voz ativa, um termo por conceito. Veja [docs/writing-rules/portugues-tecnico-simplificado.md](docs/writing-rules/portugues-tecnico-simplificado.md).

## Licença

O projeto usa a GNU General Public License versão 3 ([LICENSE](LICENSE)).
