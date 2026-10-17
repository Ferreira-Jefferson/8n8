# 8n8

Ferramenta que recebe código (um arquivo, uma pasta ou um trecho) e mostra como ele se conecta, como nós e arestas no estilo n8n. A visão começa ampla, você abre um nó para ver o fluxo interno dele e vai descendo até as linhas reais de código. Há também sugestões de melhoria presas a cada nó.

Não é migração para n8n. Do n8n só vem o modelo mental.

## Princípios do produto

- Um único diagrama de fluxo hierárquico (repositório → módulo → arquivo → função → bloco), desenhado como nós e arestas.
- A estrutura vem de parsing determinístico (Tree-sitter, um plugin por linguagem: Python e TypeScript), nunca de LLM. O LLM só escreve resumos e sugestões, sempre apontando o nó e a linha de origem.
- Todo nó leva de volta ao código real (arquivo e linhas).
- O objetivo é supervisionar e entender rápido um código, muitas vezes escrito por IA, e não ler linha por linha.

### A escada de explicação

O produto segue os degraus do método do Karpathy. Cada degrau aprofunda o anterior:

1. **Texto:** o resumo de cada nó e as sugestões são escritos em Português Técnico Simplificado. As regras estão em [docs/writing-rules/portugues-tecnico-simplificado.md](docs/writing-rules/portugues-tecnico-simplificado.md).
2. **Diagrama:** o fluxo de nós e arestas, com etapas, responsabilidades e dependências.
3. **Página interativa:** drill-down, filtros, busca e comparação.
4. **Vídeo (futuro):** um tour animado que percorre o caminho dos dados pelo fluxo.

As visualizações podem ser descartáveis: uma vista gerada para responder a uma pergunta e depois jogada fora.

## Comandos

- `pnpm install`: Instala as dependências de todos os pacotes. Também liga a pasta `.githooks`.
- `pnpm dev`: Inicia o servidor (porta 8148) e a tela (Vite). Os dois recarregam quando você muda o código.
- `pnpm dev:server`: Inicia só o servidor, sem abrir o navegador.
- `pnpm dev:ui`: Inicia só a tela, com o Vite.
- `pnpm start`: Constrói a tela e inicia o servidor e a tela juntos, sem recarga. Não abre o navegador.
- `pnpm open <pasta>`: Constrói o CLI e abre o mapa da pasta. Uma pasta relativa vale a partir de onde você digitou o comando.
- `pnpm build:cli`: Gera o pacote do CLI em `release/8-n-8-0.0.2.tgz`.
- `pnpm build:ext`: Gera o pacote da extensão em `release/8n8-vscode-0.0.1.vsix`.
- `pnpm build:all`: Instala as dependências e gera o CLI e a extensão.
- `pnpm install:cli:global`: Gera o CLI e instala o comando `8n8` no terminal.
- `pnpm prints`: Constrói o CLI e refaz as imagens do README em `docs/images`.
- `pnpm test`: Roda os testes unitários (Vitest) de todos os pacotes.
- `pnpm typecheck`: Roda o TypeScript em todos os pacotes e em `e2e`.
- `pnpm check`: Roda o Biome (estilo) e o dependency-cruiser (fronteiras).
- `pnpm e2e`: Constrói o CLI e roda os testes de ponta a ponta (Playwright). Cada execução sorteia uma faixa de portas livres (nunca a 8148). `E2E_WORKERS` muda o número de workers.
- `pnpm verify`: Roda só os testes, o typecheck e os e2e que a mudança afeta (`--plan` só mostra o plano; `--base <ref>` compara com outro commit).
- `pnpm e2e:map`: Roda a suíte e2e inteira e refaz o mapa de cobertura (`e2e/coverage-map.json`, versionado) que o `pnpm verify` usa. Leva uns 8 minutos.
- `pnpm --filter 8n8-vscode test:integration`: Constrói a extensão e roda o teste dela num VS Code de verdade. Usa o VS Code instalado ou baixa um.

Guias: [docs/guides/adicionar-linguagem.md](docs/guides/adicionar-linguagem.md), [docs/guides/adicionar-provedor-llm.md](docs/guides/adicionar-provedor-llm.md), [docs/guides/adicionar-editor.md](docs/guides/adicionar-editor.md). Contribuição: [CONTRIBUTING.md](CONTRIBUTING.md).

## Antes de codar

- Se a tarefa estiver ambígua, pergunte antes de escrever qualquer linha. Diga quais premissas você está assumindo e, se houver mais de uma leitura, mostre as opções em vez de escolher uma em silêncio.
- Defina o critério de sucesso antes de começar (teste, comando ou comportamento observável) e diga como vai verificar.
- Em tarefas com mais de um arquivo ou de direção incerta, apresente um plano curto e espere o ok.

## Ao escrever

- Faça a solução mais simples que resolve. Sem features, camadas, abstrações ou configurações que não foram pedidas.
- Mexa só no que a tarefa pede. Não refatore, renomeie nem reformate código vizinho. Código morto ou suspeito deve ser apontado, não apagado.
- Siga o estilo do código ao redor: nomes, padrões e densidade de comentários.
- Texto com barra invertida (caminho do Windows, `\n`, regex) entra no arquivo pelo Edit ou Write, nunca por heredoc ou script no shell: o shell come as barras.

## Verificação

- Toda mudança precisa ser verificada antes de ser dada como pronta: rode os testes, o typecheck ou o app. Se não deu para verificar, diga isso.
- Durante o trabalho, rode só as specs e2e ligadas à mudança (`pnpm e2e e2e/<spec>.e2e.ts`). Antes do commit, rode `pnpm verify`: ele roda só o que a mudança afeta. A suíte inteira roda no CI, em cada pull request e push na main.
- Refaça o mapa (`pnpm e2e:map`) e commite o `e2e/coverage-map.json` quando o `verify` avisar que ele está velho ou depois de criar um spec. Até lá, um spec novo roda sempre.
- Quando outro chat pode estar no mesmo repositório, trabalhe num git worktree próprio (EnterWorktree). Os testes sorteiam as portas, mas o `.cache` e o `apps/cli/dist` são da pasta.
- Relate o resultado como ele é. Teste falhando é reportado com a saída.
- Quando houver uma referência visual (vídeo, mock, print), compare prints do app com ela antes de dar a feature como pronta. Teste passando não prova que a tela é a que foi pedida.

## Segredos

- Nenhum commit pode levar chave de API, token ou senha, nem em teste, fixture, doc ou exemplo. Antes de cada commit, leia o diff staged procurando segredos.
- Em teste, use uma chave sentinela falsa e óbvia. Uma chave real vive só no `.env` (ignorado pelo git) ou na config do usuário, fora do repositório.
- Se um segredo entrar num commit, pare e avise. Não basta apagar num commit novo: a chave precisa ser revogada.
- O hook `.githooks/pre-commit` roda o gitleaks (regras em `.gitleaks.toml`) em todo commit. Nunca pule o hook com `--no-verify`.

## Explicações para mim

- Escreva as explicações em Português Técnico Simplificado: frases curtas, voz ativa, um termo por conceito.
- Quando um texto não bastar, suba um degrau: diagrama, depois página interativa.

## Confiança e direção

- Diga quando não tiver certeza, antes de seguir, e não depois.
- Se enxergar um jeito melhor ou de impacto mais duradouro do que o pedido, sugira. A decisão continua sendo minha.

## Marca

- Todo ícone ou logo do 8n8 vem do manual da marca ([docs/design/manual-marca.html](docs/design/manual-marca.html), símbolo `#wordmark`) ou de `scripts/icones.mjs`. Nunca desenhe um "parecido" nem copie só parte dele. O logo tem quatro blocos (dois ligados, dois a 20%), a aresta e as duas portas.
- Se o contexto não aceitar o logo inteiro (ex.: ícone de uma cor só), adapte as cores e mantenha todas as partes. Se não der, pergunte.
- Depois de gerar o ícone, renderize e compare com o manual antes de dar como pronto.

## Este arquivo

- Quando o Claude errar algo que uma regra evitaria, acrescente a regra aqui, curta.
- Mantenha o arquivo enxuto. Regras que nunca são quebradas podem sair.
