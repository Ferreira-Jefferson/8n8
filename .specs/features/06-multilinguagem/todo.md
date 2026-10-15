# 06 — Multilinguagem: lista de tarefas

Objetivo: uma linguagem nova entra como um plugin. O core (montagem do projeto, servidor, explicação e tela) não muda.

Critério de sucesso geral:

- `pnpm test`, `pnpm typecheck`, `pnpm check` e o e2e inteiro passam.
- Os snapshots do Python não mudam nenhum byte.
- Um segundo plugin mínimo funciona sem nenhuma mudança no core.

Legenda: **[1ª]** veio da primeira análise. **[2ª]** veio da segunda varredura.

## Decisões

- [x] D1. Há um segundo plugin, de TypeScript (`.ts`). Ele roda no fim, como teste do contrato.
- [x] D2. Os plugins ficam numa pasta central, `packages/languages/`. Cada linguagem tem a sua subpasta (`packages/languages/python/`, `packages/languages/typescript/`). O que muda de uma linguagem para outra é o parser e as regras dela. O resto é do core. Há um grafo só.
- [x] D3. O sistema escolhe o plugin pela extensão do arquivo. Arquivos de linguagens diferentes entram no mesmo grafo. Se `a.py` chama `b.ts`, o mapa mostra a ligação como se fosse um código só.
- [x] D4. Um pacote próprio descobre as ligações entre arquivos: `packages/links`. Ele reconhece três canais: rota HTTP, processo ou caminho de arquivo, e nome igual. Cada canal fica num arquivo próprio, e um canal novo entra sem mudar os outros.
- [x] D5. O trecho colado não usa extensão. Cada plugin traz um detector determinístico, que conhece as palavras reservadas, a forma de função e a de import e export da linguagem. O core roda todos os detectores e escolhe a maior nota. O LLM não entra: a detecção entre `.py` e `.ts` é possível sem ele, e a AD-001 deixa a estrutura fora do LLM.
- [x] D6. Escopo: só `.py` e `.ts`. Sem camadas extras. Uma linguagem nova entra com uma pasta em `packages/languages/` e pequenos ajustes, seguindo o guia (8.2).

Premissa: numa pasta, o plugin continua sendo escolhido pela extensão. É mais rápido e não erra. O detector serve ao trecho colado.

## Fase 1 — Contrato no `model`

- [x] 1.1 **[1ª]** `Graph.language` deixa de ser o literal `"python"`. Vira `string` (o `id` do plugin). Arquivo: `packages/model/src/graph.ts:66`.
- [x] 1.2 **[1ª]** Criar o tipo `LanguagePlugin` no `model`: `id`, `label`, `extensions`, `ignoredDirs`, `commentPrefix`, `detect`, `extractFile`, `resolveImports`, `offers`, `requests`.
- [x] 1.3 **[2ª]** O contrato não exige Tree-sitter. O plugin recebe texto e devolve nós e arestas. Um plugin pode usar outro parser, desde que seja determinístico (AD-001).
- [x] 1.4 **[2ª]** Documentar o campo `docstring` como "comentário de documentação" em geral (docstring, JSDoc, `///`). O nome do campo fica.
- [x] 1.5 **[2ª]** Corrigir o comentário de `HistoryItem.files` ("number of .py files"). Arquivo: `packages/model/src/history.ts:19`.
- [x] 1.6 **[1ª]** Registrar a decisão como AD nova no `.specs/STATE.md`. Ela atualiza a AD-004 ("gramática Python") e a AD-006.

## Fase 2 — Montagem do projeto vira genérica

- [x] 2.1 **[1ª]** Criar o pacote `@8n8/project`. Ele recebe os arquivos e os plugins e monta o `Graph` do projeto.
- [x] 2.2 **[1ª]** Mover do `extract-python/src/project.ts` para o pacote novo: `layoutProject`, `folderNode`, a montagem do nó `file`, `lastLine`, a checagem de id duplicado e a deduplicação das arestas `imports`.
- [x] 2.3 **[2ª]** Falha isolada por arquivo. Hoje um arquivo que o parser não lê lança erro e derruba o projeto inteiro (`project.ts`: `throw new Error(\`tree-sitter could not parse ...\`)`). O arquivo com falha vira um nó `file` com erro, e o resto do mapa aparece.
- [x] 2.4 **[2ª]** Validar a saída de todo plugin antes de montar: id único, `parentId` existente, arestas com origem e destino existentes, linhas dentro do arquivo. Um plugin com bug gera erro claro, não uma tela quebrada.
- [x] 2.5 **[2ª]** Suíte de conformidade reutilizável (`describe` exportado). Todo plugin roda a mesma suíte: determinismo, ids, pré-ordem, regra `openable` (VID-24), linhas 1-based. O contribuidor ganha um teste pronto.

## Fase 3 — Python vira um plugin

- [x] 3.0 **[D2]** Mover `packages/extract-python` para `packages/languages/python` (pacote `@8n8/lang-python`). Acrescentar `packages/languages/*` ao `pnpm-workspace.yaml`. Fazer o move num commit só, sem mudar código, para o histórico do Git seguir os arquivos.
- [x] 3.1 **[1ª]** O plugin exporta `pythonPlugin` e fica só com o que é de Python: `steps`, `build-graph`, `calls`, `bound`, `imports`, `modules`, `classify`.
- [x] 3.2 **[2ª]** A tabela de `classify.ts` (requests, sqlite3, smtplib) fica no plugin. O enum `ExternalCategory` fica no `model`, porque vale para qualquer linguagem.
- [x] 3.3 **[2ª]** `markSyntaxErrors` e `Parser.init()` vão para um pacote auxiliar de Tree-sitter, opcional (`@8n8/treesitter`). Hoje `Parser.init()` roda por gramática. Com dois plugins, o init roda uma vez só, e a versão do `web-tree-sitter` fica uma só.
- [x] 3.4 **[2ª]** Mudar a regra do dependency-cruiser de `extract-python` para `packages/languages/*`: um plugin importa só `model` (e o auxiliar de Tree-sitter), nunca outro plugin.
- [x] 3.5 **[1ª]** Os snapshots e testes do Python passam sem mudança.

## Fase 4 — Leitura da pasta (`input`)

- [x] 4.1 **[1ª]** `readSourceFolder` recebe uma lista de extensões, não uma só. Arquivo: `packages/input/src/read-folder.ts`.
- [x] 4.2 **[1ª]** `IGNORED_DIRS` fica só com pastas gerais (`.git`, `node_modules`, `build`, `dist`). As pastas de Python (`.venv`, `venv`, `__pycache__`, `site-packages`) vêm do plugin.

## Fase 5 — Servidor

- [x] 5.1 **[1ª]** Registro de plugins em `main.ts`: escolhe o plugin pela extensão. Remove o `".py"` fixo (`main.ts:95`) e o `createPythonExtractor()` fixo (`main.ts:132`).
- [x] 5.2 **[D5]** O servidor detecta a linguagem do trecho colado. Hoje o corpo é só `{ source }`, e o servidor não sabe a linguagem. Cada plugin dá uma nota ao texto (palavras reservadas, forma de função, de import e de export, erros de sintaxe). Ganha a maior nota. A resposta devolve `language`, e a tela mostra a linguagem escolhida.
- [x] 5.2a **[D5]** Empate ou nota baixa: o sistema usa a maior nota e a tela avisa "linguagem incerta". Testes com trechos curtos e ambíguos (uma linha `x = 1`, uma função só).
- [x] 5.3 **[2ª]** Rota nova `GET /api/languages`: devolve `id`, `label` e `extensions` de cada plugin. A tela monta os textos a partir dela.
- [x] 5.4 **[1ª]** `maskDocstring` usa o `commentPrefix` do plugin. Hoje o texto `# docstring omitida` está fixo. Arquivo: `packages/server/src/docstring.ts:3`.
- [x] 5.5 **[2ª]** Histórico: o trecho guarda a linguagem. Hoje o `content_hash` vem só do texto. O mesmo texto em duas linguagens vira uma entrada só. A linguagem entra no hash.
- [x] 5.6 **[2ª]** Histórico antigo: as entradas já salvas não têm linguagem. Na leitura, elas contam como `python`. Teste com um banco antigo.
- [x] 5.7 **[2ª]** `/api/graph` sem `try/catch`: um erro do extrator vira 500 sem mensagem. Responder com erro claro.

## Fase 6 — Explicação (`explain`)

- [x] 6.1 **[1ª]** Os quatro prompts recebem o nome da linguagem: `prompt.ts:3`, `prompt.ts:30`, `reviewer.ts:10`, `title-prompt.ts:6`, `title-reviewer.ts:15`.
- [x] 6.2 **[1ª]** Os prompts usam o marcador de docstring omitida da linguagem (`prompt.ts:6`, `prompt.ts:33`).
- [x] 6.3 **[2ª]** Cache: a linguagem entra na chave. Hoje a chave do trecho é só o `nodeId` (`fn:x`). O mesmo nome e código em duas linguagens leria a explicação errada. Com o prompt por linguagem, a versão do prompt também troca a cada linguagem e invalida o cache sem motivo real.
- [x] 6.4 **[2ª]** A troca de prompt muda a versão. As explicações em cache do Python serão geradas de novo uma vez. Avisar no commit. Nota: o texto do prompt do Python não mudou, então a versão dele ficou igual; só as explicações de trecho são geradas de novo, porque a chave passou a levar a linguagem (`<languageId>|<nodeId>`).

## Fase 7 — Tela (`apps/ui`)

- [x] 7.1 **[1ª]** Tirar os textos fixos: `App.tsx:103` (`trecho.py`), `App.tsx:327` ("arquivo .py"), `App.tsx:373` ("Trecho Python"), `Home.tsx:170` ("arquivos .py"), `DetailPanel.tsx:49` (`trecho.py`). Os textos vêm de `/api/languages`.
- [x] 7.2 **[D5]** A tela mostra a linguagem detectada do trecho e o aviso "linguagem incerta" quando for o caso.
- [x] 7.3 **[2ª]** Conferir que o card do nó (`flow/card.ts:88`) e o painel tratam o comentário de documentação de forma geral.
- [x] 7.4 **[2ª]** e2e: `e2e/multilinguagem.e2e.ts` cobre a detecção do trecho, o rótulo e o aviso de linguagem incerta, a pasta mista e a pasta sem arquivo reconhecido. Não há seletor (D5). O histórico com linguagem tem testes de servidor (`history-language.test.ts`), porque o mesmo texto não gera duas linguagens pela tela.

## Fase 8 — Prova e documentação para open source

- [x] 8.1 **[D1]** Plugin `packages/languages/typescript` (`@8n8/lang-typescript`): funções, classes, chamadas, imports, condições, laços e retornos. Passa na suíte de conformidade (2.5). Nenhum arquivo do core muda para ele entrar. Feito, com 219 testes próprios. Falta ligar a suíte de conformidade (2.5) quando `@8n8/lang-testkit` entrar.
- [x] 8.2 **[1ª]** Guia `docs/adicionar-linguagem.md`: o contrato, o passo a passo, a suíte de conformidade e um exemplo.
- [x] 8.3 **[2ª]** O repositório não tem `README.md` nem `CONTRIBUTING.md`. Para o lançamento open source, os dois precisam existir.
- [x] 8.4 **[2ª]** O `CLAUDE.md` e as ADs falam só de Python em alguns pontos. Atualizar.

## Fase 9 — Ligações entre linguagens (D3)

Python e TypeScript não se importam diretamente. Um arquivo de uma linguagem chama outro por um canal: uma rota HTTP, um processo, um caminho de arquivo. A ligação sai desse canal.

O plugin não conhece outra linguagem. Ele só declara dois tipos de dado neutros, e o core faz o casamento:

- **Oferta:** o que o arquivo expõe. Exemplos: a rota `POST /api/frete` de um handler TS, o próprio caminho `b.ts`.
- **Pedido:** o que o arquivo procura. Exemplos: `requests.post(".../api/frete")` em Python, `subprocess.run(["node", "b.ts"])`.

- [x] 9.1 Tipos `Offer` e `Request` no `model`, com o nó e a linha de origem. Mesma regra da AD-001: só parsing, sem LLM.
- [x] 9.2 Pacote `packages/links` (`@8n8/links`). Importa só o `model`. Um arquivo por canal, todos com o mesmo contrato `Linker`:
  - `http.ts`: um pedido a uma URL casa com a rota de mesmo método e caminho.
  - `process.ts`: um pedido que cita o caminho de um arquivo do projeto (`node b.ts`, `python a.py`) casa com esse arquivo.
  - `name.ts`: uma chamada a um nome que a própria linguagem não define casa com uma função de mesmo nome em outra linguagem.
- [x] 9.3 O pacote cria a aresta `calls` entre os nós. A aresta leva o canal no `label` (por exemplo, `HTTP POST /api/frete`).
- [x] 9.4 Um pedido sem oferta continua como nó `external`, como hoje.
- [x] 9.5 Um pedido com mais de uma oferta não liga nenhuma. A ligação incerta fica de fora, e o painel diz por quê. Essa regra pesa mais no canal "nome igual", que erra mais.
- [x] 9.6 Ordem de confiança: HTTP, depois processo, depois nome igual. Um pedido já ligado por um canal mais confiável não passa pelos outros.
- [x] 9.7 Fixture de projeto misto com os três canais: `a.py` chama uma rota de `b.ts`, roda `c.ts` por processo e chama uma função de `d.ts` pelo nome. Testes unit por canal e spec e2e com o mapa ligado.

## Fase 10 — Chamada ao modelo (LLM)

O pipeline já fala com o LLM por uma interface só (`LlmClient.complete`), e os testes já usam um cliente falso. Isso fica. O problema: o conhecimento do provedor e do modelo está espalhado em quatro lugares.

- [x] 10.1 O contrato `LlmClient` sai de `openrouter.ts` e vai para o `model`, como o `LanguagePlugin`. O `explain` passa a depender só do contrato, nunca de um provedor.
- [x] 10.2 Pacote `packages/llm` (`@8n8/llm`), com um arquivo por provedor e o mesmo contrato `LlmProvider` (`id`, `create(config)`):
  - `openrouter.ts`: o cliente de hoje.
  - `openai-compatible.ts`: qualquer API compatível com a da OpenAI (OpenAI, Ollama, LM Studio), só com `baseURL` e chave. Para um projeto open source, permite rodar com um modelo local e de graça.
- [x] 10.3 Os ajustes por modelo saem do código e vão para uma tabela de perfis no `llm`:
  - hoje, `openrouter.ts` desliga o raciocínio e fixa a ordem de provedores para `deepseek/` com uma regex;
  - hoje, `review.ts:76` (`jsonMode`) decide o modo JSON pelo prefixo `google/`, dentro do pipeline.
  - O perfil diz: modo JSON, raciocínio, roteamento. O pipeline pergunta ao cliente e não conhece nenhum modelo.
- [x] 10.4 Configuração única. Hoje o `main.ts` lê `OPENROUTER_API_KEY` e `OPENROUTER_BASE_URL` duas vezes (`composeExplain` e `composeTitles`) e cria dois clientes. Passa a existir uma função `resolveLlmConfig(env)` no `llm`, que devolve provedor, chave, URL, modelo e modelo do revisor. O servidor cria um cliente só e o passa aos dois.
- [x] 10.5 Variável nova `APP8N8_LLM_PROVIDER` (padrão `openrouter`). As variáveis atuais continuam valendo, para não quebrar o `.env` de ninguém. Atualizar o `.env.example`.
- [x] 10.6 `DEFAULT_MODEL` vira o padrão do provedor `openrouter`, não do sistema. Cada provedor tem o seu padrão.
- [x] 10.7 Cache: o id do provedor entra na impressão digital. O mesmo nome de modelo em dois provedores pode dar respostas diferentes.
- [x] 10.8 Regra no dependency-cruiser: `explain` não importa `llm`, e `llm` importa só o `model`. Só o servidor junta os dois.
- [x] 10.9 Testes: cada provedor com `fetch` falso (o padrão de hoje em `openrouter.test.ts`), a tabela de perfis, e `resolveLlmConfig` com cada combinação de variáveis.
- [x] 10.10 Guia `docs/adicionar-provedor-llm.md`: o contrato, o perfil de modelo e um exemplo.

## Fora do escopo

- Destaque de sintaxe no painel de código (hoje não existe para nenhuma linguagem).
- Provedores com API própria (Anthropic nativa, Gemini nativa). O guia 10.10 mostra como acoplar.
- Tentar de novo uma chamada que falhou. Hoje é uma chamada, sem retry (CORE-21), e isso fica.
