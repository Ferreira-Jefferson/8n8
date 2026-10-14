# code2n8n

Ferramenta que recebe código (um arquivo, uma pasta ou um trecho) e mostra como ele se conecta, como nós e fios no estilo n8n. A visão começa ampla, você abre um nó para ver o fluxo interno dele e vai descendo até as linhas reais de código. Há também sugestões de melhoria presas a cada nó.

Não é migração para n8n. Do n8n só vem o modelo mental.

## Princípios do produto

- Um único grafo hierárquico (repositório → módulo → arquivo → função → bloco), desenhado como fluxo de nós e fios.
- A estrutura vem de parsing determinístico (Tree-sitter), nunca de LLM. O LLM só escreve resumos e sugestões, sempre apontando o nó e a linha de origem.
- Todo nó leva de volta ao código real (arquivo e linhas).
- O objetivo é supervisionar e entender rápido um código, muitas vezes escrito por IA, e não ler linha por linha.

### A escada de explicação

O produto segue os degraus do método do Karpathy. Cada degrau aprofunda o anterior:

1. **Texto:** o resumo de cada nó e as sugestões são escritos em Português Técnico Simplificado. As regras estão em [docs/portugues-tecnico-simplificado.md](docs/portugues-tecnico-simplificado.md).
2. **Diagrama:** o fluxo de nós e fios, com etapas, responsabilidades e dependências.
3. **Página interativa:** drill-down, filtros, busca e comparação.
4. **Vídeo (futuro):** um tour animado que percorre o caminho dos dados pelo fluxo.

As visualizações podem ser descartáveis: uma vista gerada para responder a uma pergunta e depois jogada fora.

## Comandos

<!-- Preencher quando a stack existir. Ex.: instalar, rodar, testar, lint, typecheck. -->

## Antes de codar

- Se a tarefa estiver ambígua, pergunte antes de escrever qualquer linha. Diga quais premissas você está assumindo e, se houver mais de uma leitura, mostre as opções em vez de escolher uma em silêncio.
- Defina o critério de sucesso antes de começar (teste, comando ou comportamento observável) e diga como vai verificar.
- Em tarefas com mais de um arquivo ou de direção incerta, apresente um plano curto e espere o ok.

## Ao escrever

- Faça a solução mais simples que resolve. Sem features, camadas, abstrações ou configurações que não foram pedidas.
- Mexa só no que a tarefa pede. Não refatore, renomeie nem reformate código vizinho. Código morto ou suspeito deve ser apontado, não apagado.
- Siga o estilo do código ao redor: nomes, padrões e densidade de comentários.

## Verificação

- Toda mudança precisa ser verificada antes de ser dada como pronta: rode os testes, o typecheck ou o app. Se não deu para verificar, diga isso.
- Durante o trabalho, rode só as specs e2e ligadas à mudança (`pnpm e2e e2e/<spec>.e2e.ts`). Rode a suíte inteira uma vez, antes do commit.
- Relate o resultado como ele é. Teste falhando é reportado com a saída.
- Quando houver uma referência visual (vídeo, mock, print), compare prints do app com ela antes de dar a feature como pronta. Teste passando não prova que a tela é a que foi pedida.

## Explicações para mim

- Escreva as explicações em Português Técnico Simplificado: frases curtas, voz ativa, um termo por conceito.
- Quando um texto não bastar, suba um degrau: diagrama, depois página interativa.

## Confiança e direção

- Diga quando não tiver certeza, antes de seguir, e não depois.
- Se enxergar um jeito melhor ou de impacto mais duradouro do que o pedido, sugira. A decisão continua sendo minha.

## Este arquivo

- Quando o Claude errar algo que uma regra evitaria, acrescente a regra aqui, curta.
- Mantenha o arquivo enxuto. Regras que nunca são quebradas podem sair.
