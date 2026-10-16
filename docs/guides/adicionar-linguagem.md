# Adicionar uma linguagem

Cada linguagem é um plugin em `packages/languages/<id>`. O plugin lê o código e devolve um grafo. O core monta o mapa, as ligações, o servidor e a tela sem conhecer nenhuma linguagem.

Este guia usa o plugin TypeScript (`packages/languages/typescript`) como exemplo real. O plugin Python (`packages/languages/python`) segue o mesmo contrato.

Uma linguagem nova pede uma pasta nova e pequenos ajustes em dois arquivos do servidor. Nenhum arquivo do core muda.

## Por que um plugin por linguagem

O Tree-sitter tem gramática pronta para muitas linguagens, mas ele só devolve a árvore de sintaxe. O plugin precisa dizer o que a árvore significa: o que é função, import, rota HTTP e chamada de processo. Isso muda com a linguagem e com a biblioteca. Sem isso, o mapa perde as ligações entre linguagens. A gramática vem pronta (veja `packages/languages/treesitter`). As regras de extração são o trabalho de um plugin novo. A decisão está na AD-028, em `.specs/STATE.md`.

## O contrato `LanguagePlugin`

O contrato fica em `packages/model/src/plugin.ts`. Veja o plugin TypeScript em `packages/languages/typescript/src/index.ts`:

```ts
export const typescriptPlugin: LanguagePlugin = {
  id: "typescript",
  label: "TypeScript",
  extensions: [".ts", ".tsx"],
  ignoredDirs: [".next", "coverage"],
  commentPrefix: "//",
  detect: detectTypescript,
  extract: extractSnippet,
  analyze: analyzeFiles,
};
```

| Campo | O que é |
|---|---|
| `id` | Id estável. Vai em `Graph.language` e nas chaves de cache. Minúsculas, começa com letra (`^[a-z][a-z0-9-]*$`). Não pode ser `mixed`: esse valor é do projeto com mais de uma linguagem. |
| `label` | Nome para a tela. Ex.: `TypeScript`. |
| `extensions` | Extensões com o ponto e em minúsculas. Ex.: `[".ts", ".tsx"]`. O core escolhe o plugin pela extensão do arquivo. |
| `ignoredDirs` | Pastas que só esta linguagem tem e que a leitura da pasta pula. Só o nome, sem `/`. O core já pula `.git`, `node_modules` e outras comuns (`IGNORED_DIRS` em `packages/input/src/read-folder.ts`). |
| `commentPrefix` | Início de um comentário de linha. Ex.: `#`, `//`. |
| `detect(source)` | Nota de 0 a 1: quanto o texto parece ser desta linguagem. Serve ao trecho colado, que não tem extensão. |
| `extract(source)` | Devolve o `Graph` de um trecho. |
| `analyze(files)` | Lê um conjunto de arquivos da linguagem. Os caminhos são POSIX e relativos à raiz do projeto. |

Todos os métodos são síncronos. Se a gramática carrega de forma assíncrona, carregue na importação do módulo. O plugin TypeScript faz isso em `packages/languages/typescript/src/parse.ts` com `await loadParser(...)` no nível do módulo.

### O que `analyze` devolve

`analyze` devolve um `LanguageAnalysis`:

```ts
interface LanguageAnalysis {
  files: { path: string; graph: Graph }[];
  imports: FlowEdge[];
  offers: Offer[];
  requests: LinkRequest[];
}
```

- `files`: um grafo por arquivo recebido. O **primeiro nó** de cada grafo é o nó `file`. Os outros nós usam o id dele como prefixo.
- `imports`: arestas `imports` entre arquivos da mesma linguagem. Uma aresta por par (origem, destino). O `source` e o `target` são ids de nós `file`. O id da aresta no TypeScript é `imports:<origem>-><destino>`. Toda aresta aqui tem `kind: "imports"`.
- `offers`: o que o arquivo expõe (uma rota, o próprio caminho, uma função).
- `requests`: o que o arquivo procura (uma URL chamada, um caminho executado, um nome chamado).

Para um conjunto vazio de arquivos, devolva `{ files: [], imports: [], offers: [], requests: [] }`.

## As regras do grafo

O tipo `Graph` fica em `packages/model/src/graph.ts`. A suíte de conformidade confere todas as regras abaixo.

- **Ids estruturais.** O id sai do caminho na estrutura, não da posição no texto. As funções `topLevelId`, `childId`, `folderId` e `fileId` ficam em `packages/model/src/ids.ts`. Exemplos: `fn:nome`, `cls:Nome`, `fn:nome#2` para o segundo nome repetido, `file:src/a.ts`. Um nó interno usa o id do arquivo como prefixo: `file:src/a.ts/fn:nome`.
- **Ids únicos.** Nenhum id se repete, nem entre arquivos.
- **Pré-ordem.** Os nós ficam na ordem do código. O pai de um nó é o nó anterior ou um ancestral dele.
- **Linhas 1-based e inclusivas.** `range: { start, end }` conta a partir da linha 1, e a linha `end` entra. O `end` não passa da última linha do texto.
- **Nó `file`.** O primeiro nó de cada grafo do `analyze`. O `id` é `file:<caminho>`, o `kind` é `"file"`, o `path` é o caminho POSIX, e o `range` vai da linha 1 à última linha do arquivo.
- **Regra `openable` (VID-24).** Um nó abre para mostrar o fluxo interno dele. Valem estas regras:
  - `openable: true` em `folder`, `file`, `module`, `function`, `class`, `loop` e `block`.
  - `openable: true` em `call` só quando o nó tem `target`. Sem `target`, é `false`.
  - `openable: false` em `code`, `condition`, `external` e `return`.
- **Arestas.** As arestas do grafo usam os tipos `calls`, `next`, `branch`, `imports` e `extends`. O tipo `contains` nunca entra num `Graph`: a tela desenha essa aresta.
- **Herança (`extends`).** A aresta vai da classe filha (`source`) para a classe base (`target`). O id é `extends:<origem>-><destino>`. Valem estas regras:
  - Só classes de topo (as de id `cls:Nome`). Classe aninhada fica de fora.
  - A base precisa resolver para uma classe do trecho ou do projeto. Resolva o nome como as chamadas `calls`: primeiro os nomes de topo do arquivo, depois os imports (`resolveImport`). Base externa ou desconhecida não gera aresta.
  - Uma aresta por par (filha, base). Ignore a autoherança.
  - Entre arquivos, a aresta fica no grafo do arquivo da filha, com os ids já prefixados por `file:<caminho>`. O destino precisa ser um nó `class`: a suíte de conformidade confere isso.
- **Toda aresta aponta para nós que existem** no conjunto de grafos do `analyze`.
- **Determinismo.** O mesmo texto gera o mesmo grafo, sempre. Chamar duas vezes devolve valores iguais.
- **Sem LLM.** A estrutura vem do parser. Nunca peça nada a um modelo de linguagem dentro de um plugin (AD-001).
- **`Graph.language`** vale o `id` do plugin. `empty` vale `true` só quando `nodes` está vazio.
- **Erro de sintaxe.** Um erro de sintaxe não derruba a leitura. O plugin marca o nó com `syntaxError` e segue. Use `markSyntaxErrors` do `lang-treesitter` (veja abaixo).

## Passo a passo

### 1. Crie a pasta do pacote

Copie `packages/languages/typescript` para `packages/languages/<id>` e ajuste. Três arquivos de configuração:

`package.json` (ajuste `name` e as dependências da gramática):

```json
{
  "name": "@8n8/lang-typescript",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@8n8/lang-treesitter": "workspace:*",
    "@8n8/model": "workspace:*",
    "tree-sitter-typescript": "0.23.2",
    "web-tree-sitter": "0.27.1"
  },
  "devDependencies": {
    "@8n8/lang-testkit": "workspace:*",
    "@types/node": "22.20.5"
  }
}
```

O pacote exporta só `"."`, o `src/index.ts`. Chame o pacote de `@8n8/lang-<id>`.

`tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/__tests__/fixtures"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
});
```

O `pnpm-workspace.yaml` já inclui `packages/languages/*`. Rode `pnpm install` na raiz para ligar o pacote novo. Se a gramática (`tree-sitter-<lang>`) tem script de instalação, confira a lista `allowBuilds` do `pnpm-workspace.yaml`: as gramáticas atuais estão lá com `false`.

### 2. Escreva o plugin

Crie `src/index.ts` com o objeto `LanguagePlugin`, como no exemplo acima. Divida o resto em arquivos pequenos. O plugin TypeScript usa estes:

| Arquivo | Papel |
|---|---|
| `src/parse.ts` | Carrega a gramática uma vez. |
| `src/build-graph.ts` | Monta nós e arestas de uma árvore. |
| `src/extract.ts` | `extract`: o grafo de um trecho. |
| `src/analyze.ts` | `analyze`: um grafo por arquivo, arestas `imports`, ofertas e pedidos. |
| `src/detect.ts` | `detect`: a nota da linguagem. |
| `src/links.ts` | Ofertas e pedidos de cada arquivo. |

Você pode usar outro parser. Só o `lang-treesitter` é um auxiliar pronto.

### 3. Use o `lang-treesitter` (opcional)

O pacote `@8n8/lang-treesitter` (`packages/languages/treesitter`) guarda o que toda gramática Tree-sitter repete:

- `loadParser(wasmPath)`: inicia o Tree-sitter e devolve um parser com a gramática do arquivo `.wasm`. Carrega cada gramática uma vez por processo.
- `loadLanguage(wasmPath)`: o mesmo, mas devolve só a `Language`.
- `markSyntaxErrors(tree, graph, fallbackId)`: marca em `syntaxError` os nós que têm erro de sintaxe. Se o erro cai fora de todo nó interno, o `fallbackId` recebe a marca.
- `treeErrorLines(root)`: as linhas (1-based) de cada nó `ERROR` ou `MISSING`. `markErrorLines`: marca `syntaxError.line` no nó mais interno de cada linha.
- `innermost(nodes, line)`: o nó mais interno que cobre a linha.
- `lineRange(node)`: as linhas 1-based e inclusivas de um nó do Tree-sitter. `lastLine(source)`: o número da última linha do texto.

Exemplo real, de `packages/languages/typescript/src/parse.ts`:

```ts
export function loadParser(dialect: Dialect): Promise<Parser> {
  const wasm = createRequire(import.meta.url).resolve(
    `tree-sitter-typescript/tree-sitter-${dialect}.wasm`,
  );
  return loadGrammar(wasm);
}

export const parsers: Record<Dialect, Parser> = {
  typescript: await loadParser("typescript"),
  tsx: await loadParser("tsx"),
};
```

Siga este padrão para a gramática funcionar também no pacote da CLI:

- Declare o pacote da gramática (`tree-sitter-<linguagem>`) em `dependencies`, não em `devDependencies`. O build da CLI copia o `.wasm` de toda dependência `tree-sitter-*` de cada plugin.
- Ache o arquivo com `createRequire(import.meta.url).resolve("<pacote>/<arquivo>.wasm")`. No bundle, o build troca esse `createRequire` por um que aponta para a pasta `grammars/` ao lado do pacote. Outro jeito de achar o `.wasm` quebra no pacote instalado.

O teste `apps/cli/src/__tests__/build.test.ts` empacota os plugins e confere que o bundle extrai o mesmo grafo que o código-fonte.

### 4. Declare ofertas e pedidos

Veja a seção [Ligações entre linguagens](#ligações-entre-linguagens). Se a linguagem não tem como chamar outra, devolva `offers` e `requests` vazios. A conformidade aceita.

### 5. Escreva o `detect`

Veja a seção [Detecção do trecho colado](#detecção-do-trecho-colado).

### 6. Rode a suíte de conformidade

O pacote `@8n8/lang-testkit` (`packages/languages/testkit`) exporta `describeLanguagePlugin(plugin, fixtures)`. Toda linguagem roda a mesma suíte. Exemplo real, de `packages/languages/typescript/src/__tests__/plugin.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describeLanguagePlugin } from "@8n8/lang-testkit";
import { typescriptPlugin } from "../index";
import { lojaFiles } from "./loja";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

describeLanguagePlugin(typescriptPlugin, {
  snippets: [
    fixture("pedido-frete.ts"),
    "export function f(a: number) {\n  return (a +\n",
    "const x = 1;\n",
    "",
  ],
  files: [
    ...lojaFiles(),
    { path: "erro.ts", source: "export function g() {\n  const x = (1 +\n" },
  ],
});
```

As `fixtures` têm dois campos:

- `snippets`: trechos da linguagem, para `extract` e `detect`. Inclua um trecho com erro de sintaxe, uma linha só e um texto vazio.
- `files`: os arquivos de um projeto pequeno, para `analyze`. Os caminhos são POSIX. Inclua um arquivo com erro de sintaxe.

A suíte confere:

- `id`, `label`, `extensions`, `commentPrefix` e `ignoredDirs` bem formados;
- `extract` determinístico, com `Graph.language` igual ao `id`, ids únicos, pré-ordem, linhas 1-based dentro do texto e a regra `openable`;
- `detect` determinístico, com nota entre 0 e 1;
- `analyze` determinístico, com um grafo por arquivo, o nó `file` primeiro, ids sob `file:<caminho>`, ids únicos entre arquivos, arestas que apontam para nós que existem, arestas `imports` do tipo `imports`, e ofertas e pedidos que apontam para nós que existem, com linha inteira maior ou igual a 1;
- `analyze` de nenhum arquivo devolve tudo vazio.

Rode só o pacote novo:

```bash
pnpm --filter @8n8/lang-<id> test
```

A suíte não prova que o grafo é útil. Escreva também testes do que é próprio da linguagem: funções, classes, chamadas, imports, condições, laços e retornos. O plugin TypeScript tem esses testes em `packages/languages/typescript/src/__tests__/`.

### 7. Registre o plugin no servidor

Dois ajustes, e só neles.

Em `packages/server/package.json`, acrescente a dependência junto das outras linguagens:

```json
"@8n8/lang-<id>": "workspace:*",
```

Em `packages/server/src/core.ts`, importe o plugin e inclua na lista `languagePlugins`:

```ts
import { pythonPlugin } from "@8n8/lang-python";
import { typescriptPlugin } from "@8n8/lang-typescript";

/** The languages the server knows; a new language is one more entry. */
export const languagePlugins: LanguagePlugin[] = [
  pythonPlugin,
  typescriptPlugin,
];
```

A ordem importa em um caso: no trecho colado, um empate de nota vai para o primeiro plugin da lista. Rode `pnpm install` de novo e confira com `pnpm typecheck` e `pnpm test`.

Depois do registro, o servidor passa a:

- ler a pasta com as `extensions` e as `ignoredDirs` do plugin;
- escolher o plugin de cada arquivo pela extensão;
- detectar a linguagem do trecho colado;
- incluir a linguagem (`id`, `label` e `extensions`) na resposta de `GET /api/languages`, de onde a tela tira os textos.

## Regras de fronteira (dependency-cruiser)

O `pnpm check` roda o `dependency-cruiser` com as regras de `.dependency-cruiser.cjs`. Duas regras valem para plugins:

- `languages-only-model`: um plugin importa só `@8n8/model`, `@8n8/lang-testkit` e `@8n8/lang-treesitter`. Ele não importa `explain`, `llm`, `server` nem `apps`.
- `languages-do-not-import-each-other`: um plugin **nunca** importa outro plugin. Só o `lang-testkit` e o `lang-treesitter` são comuns. Código que dois plugins precisam fica no `lang-treesitter` ou no `model`. Se for pouco, copie.

Outras regras valem para todo pacote: sem ciclos, e nenhum caminho relativo sai da pasta do pacote (`../../packages/...`).

O `pnpm check` falha se você quebrar uma regra.

## Ligações entre linguagens

Um arquivo de uma linguagem chama um de outra por um **canal**. O plugin só declara dados neutros e não conhece a outra linguagem. O pacote `packages/links` casa pedidos com ofertas e desenha as arestas.

Os tipos `Offer` e `LinkRequest` têm os mesmos campos:

```ts
{ channel: "http" | "process" | "name"; key: string; nodeId: NodeId; line: number }
```

`nodeId` é o nó que tem a oferta ou o pedido (um nó que existe nos grafos do `analyze`). `line` é a linha, a partir de 1.

Há três canais. O `links` testa nesta ordem e para no primeiro que liga: `http`, `process`, `name`.

| Canal | Oferta (`key`) | Pedido (`key`) | Casa quando |
|---|---|---|---|
| `http` | `METHOD /caminho`, ex.: `POST /api/frete`. Use `*` no método se não souber. | `METHOD /caminho` ou uma URL ou caminho sem método (método `*`). | O método é igual (ou um dos lados é `*`) e os segmentos do caminho são iguais. Um segmento `:id`, `{id}` ou `<id>` casa com qualquer um. Esquema, host, porta, `?query` e `#fragmento` saem. |
| `process` | O caminho do próprio arquivo, relativo à raiz, ex.: `scripts/b.ts`. | O texto do caminho, como está no código, ex.: `node b.ts`. | Alguma palavra do pedido, resolvida a partir da raiz ou da pasta do arquivo que pede, é igual ao caminho da oferta. |
| `name` | O nome de uma função exportada. | O nome chamado. | O nome é igual. |

Só o canal `http` casa dentro da mesma linguagem. Os canais `process` e `name` ignoram uma oferta do mesmo arquivo ou da mesma linguagem (a mesma extensão), porque dentro da linguagem a aresta `imports` já cobre.

Um pedido sem oferta fica como nó `external`. Um pedido com mais de uma oferta possível não liga nada, para não errar.

Veja como o plugin TypeScript declara cada canal em `packages/languages/typescript/src/links.ts`:

- **Oferta `http`:** `app.get("/x", handler)` em um objeto `app`, `router`, `server`, `fastify`, `api` ou `routes`. Gera `{ channel: "http", key: "GET /x", ... }` com o nó do handler quando ele é uma função do arquivo.
- **Pedido `http`:** `fetch`, `axios` e `got`. Um `${...}` na URL vira `:param`. Sem `method`, o método é `GET`.
- **Oferta `process`:** todo arquivo oferece o próprio caminho:
  ```ts
  offers.push({ channel: "process", key: path, nodeId: prefix, line: 1 });
  ```
- **Pedido `process`:** `exec`, `execSync`, `execFile`, `execFileSync`, `spawn`, `spawnSync` e `fork` do `child_process`. A `key` é o primeiro token que parece um arquivo (`b.py`, `./b.ts`).
- **Oferta `name`:** cada função de nível superior exportada, pelo nome exportado.
- **Pedido `name`:** uma chamada a um nome simples que o arquivo nem define nem importa (classificada como externa).

O plugin Python faz o equivalente para as bibliotecas dele em `packages/languages/python/src/links.ts`. Declare só o que o seu parser enxerga com segurança. Um pedido errado cria uma aresta falsa.

## Detecção do trecho colado

Um trecho colado não tem extensão. O `detect` dá uma nota de 0 a 1 para o texto, e o core escolhe a linguagem com `detectLanguage` (`packages/project/src/detect.ts`):

1. Cada plugin dá a nota. O de maior nota ganha. Em empate de nota, ganha o primeiro da lista `languagePlugins`.
2. A resposta traz `uncertain: true` (a tela mostra o aviso "linguagem incerta") quando:
   - a melhor nota é menor que `MIN_CONFIDENT_SCORE`, que vale **0,5**; ou
   - a segunda melhor nota fica a menos de `MIN_SCORE_MARGIN` da melhor, que vale **0,15**.
3. Com um plugin só, nunca há empate. Só vale o limiar de 0,5.

Como escrever um bom `detect`:

- Devolva 0 para texto vazio.
- Some pontos para formas que só esta linguagem escreve, e tire pontos para formas de outra. O TypeScript tira pontos de formas do Python (`def`, `elif`, `self`).
- Limite o ponto de cada forma (`cap`), para um padrão repetido não decidir sozinho.
- Reduza a nota quando o texto tem erro de sintaxe na gramática.
- Normalize para o intervalo de 0 a 1. O TypeScript usa `raw / (raw + 4)`.
- Uma linha ambígua, como `x = 1`, deve ficar perto de 0.
- Seja determinístico. O mesmo texto dá a mesma nota.

O código está em `packages/languages/typescript/src/detect.ts`. Cada plugin vê só o seu texto: não importe outro plugin para comparar.

## Checklist final

- [ ] A pasta `packages/languages/<id>` tem `package.json`, `tsconfig.json`, `vitest.config.ts` e `src/index.ts`.
- [ ] O `id` é novo, em minúsculas, e não é `mixed`.
- [ ] A primeira entrada de cada grafo do `analyze` é o nó `file`.
- [ ] A suíte `describeLanguagePlugin` passa, com um trecho de erro de sintaxe e um arquivo de erro de sintaxe nas fixtures.
- [ ] Há testes próprios para funções, classes, chamadas, imports, condições, laços e retornos da linguagem.
- [ ] `pnpm install` rodou e o plugin aparece no `packages/server/package.json` e em `languagePlugins`.
- [ ] A gramática está em `dependencies`, é achada com `createRequire(import.meta.url).resolve(...)`, e `pnpm --filter 8n8 test` passa.
- [ ] `pnpm typecheck`, `pnpm test` e `pnpm check` passam. O `check` confere as fronteiras e o Biome.
- [ ] O plugin não importa outro plugin nem o LLM.
- [ ] `ignoredDirs` lista as pastas de dependências e de build da linguagem.
- [ ] Ofertas e pedidos só cobrem o que o parser enxerga com segurança.

## Limites conhecidos

- Cada linguagem precisa de um parser que rode em Node. O auxiliar pronto é o Tree-sitter via `web-tree-sitter` (arquivos `.wasm`).
- Os métodos do plugin são síncronos. A gramática carrega uma vez, na importação.
- O plugin entra no código do servidor: o registro em `languagePlugins` e a dependência no `package.json` são manuais. Não há carregamento dinâmico de plugin.
- Os três canais de ligação (`http`, `process`, `name`) são fixos. Um canal novo pede mudança no pacote `links` e no tipo `LinkChannel` do `model`.
- O `detect` do trecho colado é uma nota por regras, não uma garantia. Linguagens parecidas (como TypeScript e JavaScript) empatam, e a tela avisa "linguagem incerta".
- A suíte de conformidade confere a forma do grafo, não o seu valor. Um grafo bem formado pode ser pobre.
- Os textos de linguagem da tela vêm do `GET /api/languages`, ou seja, de `id`, `label` e `extensions`.
