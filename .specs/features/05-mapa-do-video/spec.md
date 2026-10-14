# Mapa do Vídeo Specification

## Problem Statement

O app funciona por baixo, mas não entrega o que o vídeo de referência mostra. O vídeo é https://claude.ai/artifact/Q9eF9qdTfdEUFh6wTSbNa1, e o usuário o aprovou como "exatamente" a visão do produto.

Hoje o mapa tem cara de página sem estilo e mostra só as funções definidas, mais um nó "Módulo" solto. Os passos se chamam "Código", os retornos continuam o fluxo e os passos de dentro de uma função não têm resumo. As sugestões ficam escondidas numa lista.

Quem abre o app não reconhece o produto do vídeo.

Depende de: 01-fatia-central, 04-fidelidade-e-cache e 02-pasta-local.

## Goals

- [ ] As cenas de produto do vídeo funcionam no app real, com o código do vídeo. São elas: "Cole o código", "O mapa", "Dentro do nó", "O detalhe" e "Sugestões".
- [ ] O usuário compara prints do app com os quadros do vídeo, lado a lado, e aprova.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Modo grafo (cena "Modo grafo") | Continua adiado por decisão do usuário em 2026-10-13. A spec 03 fica guardada. |
| Cenas de apresentação ("Parede de código", "Quatro degraus" e "Final") | Elas apresentam o produto e não são telas do app. |
| Tour em vídeo (degrau 4) | Feature futura. |
| Explicar todos os nós ao gerar o mapa | Decisão do usuário: resumo e sugestões só aparecem depois de abrir o nó. |
| Música e som | O vídeo tem trilha; o app não. |

**Deferred:**

- Escala: muitas chamadas na mesma linha do fluxo principal. Adiado até aparecer um caso real.
- Custo: limite de pedidos de título por minuto. Adiado porque cada nível gera um pedido só e o cache evita repetição.
- Observabilidade: as dimensões restantes ficam adiadas.

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Modo grafo | Fica fora desta entrega | Pedido do usuário | y |
| Origem dos títulos | O LLM escreve os títulos em PTS. Eles passam pelo revisor e ficam presos às linhas. | Pedido do usuário. A regra "o LLM só escreve resumos e sugestões" passa a incluir títulos. | y |
| Quando o resumo e as sugestões chegam | Só depois de abrir o nó | Pedido do usuário | y |
| Quando os títulos chegam | Ao mostrar um nível, o sistema faz um pedido só, com os títulos de todos os nós visíveis | O mapa do vídeo mostra títulos sem que nada tenha sido aberto. Esperar a abertura do nó contradiz o vídeo. | n |
| O vídeo é a régua de aparência e comportamento | Cores, fontes, cartões, fios, etiquetas, trilha de navegação e painel seguem o vídeo | O usuário pediu "exatamente o que tem no vídeo" | y |
| O número de nós segue a regra, não o vídeo | Cada chamada do corpo da entrada vira um nó. O vídeo omite `db.buscar_cliente` e `soma_itens`; o app mostra os dois. | O vídeo é um conceito. Uma regra determinística vale mais do que imitar uma omissão. | n |
| Agrupamento dos passos | Continua a regra atual: comandos seguidos sem chamada viram um passo | O vídeo junta `requests.get` e `r.json()` num passo só. Mudar o agrupamento mexe na estrutura, que é determinística. Os títulos cobrem a diferença. | n |
| Etiqueta dos arquivos de pasta e da escrita em disco | Nó de arquivo do projeto: "ARQUIVO". Chamada externa de `open` ou `pathlib`: "DISCO". | Evita a mesma palavra para duas coisas (um termo por conceito). | n |
| Fontes | Archivo Black (títulos), Space Grotesk (texto) e DM Mono (código), servidas pelo próprio app | São as fontes do vídeo. O app é local e não depende de rede para abrir. | n |
| Volta ao editor | Um botão "Novo código" no canto do mapa volta ao editor com o texto mantido | O vídeo não mostra a volta, mas sem ela o usuário fica preso no mapa | n |
| Abrir um nó | Um clique abre o fluxo interno e mostra o painel ao mesmo tempo. O duplo clique deixa de ser necessário. | Pedido do usuário: "quando eu clicar em um nó ele deve mostrar o n8n interno" | y |
| Até onde se desce | Até as folhas. Uma condição é folha porque os ramos dela já aparecem no mesmo nível, como no vídeo. | Pedido do usuário: "até não ter como criar mais ramificações" | n |
| Como voltar | Botão "Voltar" e tecla Esc, um nível por vez. A trilha continua permitindo pular vários níveis. | Pedido do usuário: "deve ser possível voltar pro nó anterior" | y |
| Nome do arquivo no cabeçalho do editor | "trecho.py" | O vídeo mostra o nome do arquivo no cabeçalho; um trecho colado não tem nome | n |

**Open questions:** none. Todas foram resolvidas ou registradas acima.

---

## User Stories

### P1: O mapa do vídeo ⭐ MVP

**User Story**: Como desenvolvedor, quero colar o código e ver o fluxo do negócio com a aparência do vídeo, para entender o código num olhar.

**Why P1**: É o que o vídeo promete e o que o app não entrega hoje.

**Acceptance Criteria** (each line is one EARS pattern):

1. The system SHALL desenhar o canvas com fundo `#121110` e uma grade de pontos a cada 40 px. O texto é `#F5F2EC`, o destaque é `#D4FF3F` e o texto secundário é `#A8A399`.  <!-- VID-01 -->
2. The system SHALL usar Archivo Black nos títulos de tela, Space Grotesk no texto e DM Mono no código. As três fontes são servidas pelo próprio app.  <!-- VID-02 -->
3. The system SHALL desenhar cada nó como um cartão com três linhas: a etiqueta do tipo em maiúsculas, o título em negrito e uma linha de código em fonte mono, por exemplo `calcular_frete()` ou `requests.get()`. O cartão tem uma porta circular `#D4FF3F` em cada lado ligado por um fio.  <!-- VID-03 -->
4. The system SHALL usar exatamente estas etiquetas: GATILHO (entrada do fluxo), FUNÇÃO (função ou classe do código analisado), HTTP, BANCO, DISCO, E-MAIL, EXTERNO, SE (condição), LAÇO, BLOCO, CÓDIGO, RETORNO, PASTA e ARQUIVO.  <!-- VID-04 -->
5. The system SHALL desenhar os fios como curvas `#D4FF3F` com 4 px de espessura.  <!-- VID-05 -->
6. WHEN um nível do mapa aparece THEN the system SHALL mostrar os nós da esquerda para a direita, desenhar cada fio logo depois do nó de origem e fazer um ponto percorrer cada fio uma vez, na ordem do fluxo.  <!-- VID-06 -->
7. WHERE o sistema operacional pede menos movimento (`prefers-reduced-motion: reduce`) the system SHALL mostrar o nível completo, sem animação.  <!-- VID-07 -->
8. WHILE não há mapa the system SHALL mostrar o editor como um painel. O painel tem o cabeçalho "trecho.py" em `#D4FF3F`, a área de código em DM Mono, o botão "Gerar mapa" com fundo `#D4FF3F` e o campo de pasta com o botão "Abrir pasta".  <!-- VID-08 -->
9. WHEN o usuário clica em "Gerar mapa" e o mapa é gerado THEN the system SHALL trocar o editor pelo mapa ocupando a tela e mostrar o botão "Novo código". Esse botão volta ao editor com o texto mantido.  <!-- VID-09 -->
10. WHEN o mapa de um trecho é gerado THEN the system SHALL mostrar no primeiro nível ("Fluxo principal"), para cada entrada, um nó GATILHO seguido de um nó por comando com chamada no corpo da entrada. Os nós seguem a ordem do código e são ligados por fios.  <!-- VID-10 -->
11. The system SHALL considerar como entrada o código solto no nível do módulo, quando ele existe. Sem código solto, cada função de topo que nenhuma função do trecho chama é uma entrada. Com mais de uma entrada, cada uma ganha uma linha própria, de cima para baixo, na ordem do código.  <!-- VID-11 -->
12. The system SHALL não mostrar um nó "Módulo" no primeiro nível.  <!-- VID-12 -->
13. WHEN uma chamada vai para um nome que o trecho não define nem importa THEN the system SHALL mostrar o nó com a categoria da tabela abaixo e sem fio de chamada para outro nó (PROJ-09 continua valendo). A categoria se decide nesta ordem: (a) o primeiro segmento do nome chamado é exatamente `db`, `cursor`, `conn`, `connection` ou `session`: BANCO; (b) o último segmento contém `email`, sem diferenciar maiúsculas: E-MAIL; (c) a tabela de classificação atual; (d) qualquer outro caso: EXTERNO.  <!-- VID-13 -->
14. WHEN um nível aparece THEN the system SHALL pedir ao LLM, num único pedido para o nível, um título em PTS de no máximo 6 palavras para cada nó visível, e SHALL mostrar cada título no lugar do nome provisório quando ele chegar.  <!-- VID-14 -->
15. WHILE o título de um nó não chegou, ou não há chave do OpenRouter, ou o pedido falhou, the system SHALL mostrar um nome provisório. O nome provisório de uma função ou chamada é o último segmento do nome, com `_` trocado por espaço e a primeira letra maiúscula (`calcular_frete` vira "Calcular frete"). O de uma condição é o texto dela, e o de um bloco de código é "Código".  <!-- VID-15 -->
16. IF o revisor não confirma um título pelas linhas do nó THEN the system SHALL descartar o título e manter o nome provisório.  <!-- VID-16 -->
17. The system SHALL guardar os títulos no cache com a mesma impressão digital dos resumos: código do nó, vizinhos, modelo, modelo revisor e versão do prompt.  <!-- VID-17 -->
18. WHEN o usuário abre um nó THEN the system SHALL expandir o cartão até virar uma moldura com borda `#D4FF3F` que ocupa o canvas, e só depois mostrar os passos internos.  <!-- VID-18 -->
19. The system SHALL mostrar na trilha de navegação "Fluxo principal" seguido do título de cada nó aberto, separados por "›".  <!-- VID-19 -->
20. WHEN um comando `return` aparece no corpo de um nó THEN the system SHALL criar um passo RETORNO próprio, sem fio de saída para o passo seguinte.  <!-- VID-20 -->
21. WHEN uma condição tem os ramos "sim" e "não" THEN the system SHALL desenhar o primeiro passo do ramo "sim" acima do primeiro passo do ramo "não", com os rótulos "sim" e "não" junto ao início de cada fio.  <!-- VID-21 -->
22. WHEN o usuário seleciona um nó THEN the system SHALL desenhar a borda do cartão em `#D4FF3F`.  <!-- VID-22 -->
23. WHEN o usuário clica uma vez num nó que tem fluxo interno THEN the system SHALL abrir o fluxo interno desse nó no canvas e mostrar o painel do nó.  <!-- VID-23 -->
24. The system SHALL considerar que um nó tem fluxo interno quando ele é PASTA, ARQUIVO, GATILHO, FUNÇÃO, LAÇO ou BLOCO, ou quando ele é uma chamada para uma função do código analisado. Nesse caso, o fluxo interno é o fluxo da função chamada. Os outros nós são folhas: CÓDIGO, SE, RETORNO, HTTP, BANCO, DISCO, E-MAIL e EXTERNO.  <!-- VID-24 -->
25. WHEN o usuário clica numa folha THEN the system SHALL selecionar o nó e mostrar o painel dele, sem trocar o nível do canvas.  <!-- VID-25 -->
26. The system SHALL marcar os cartões com fluxo interno com o sinal "›" depois do título, e SHALL não marcar as folhas.  <!-- VID-26 -->
27. WHEN o usuário clica em "Voltar", no canto superior esquerdo do canvas, ou aperta Esc THEN the system SHALL voltar ao nível anterior e deixar selecionado e centralizado o nó que tinha sido aberto. No primeiro nível, "Voltar" fica desabilitado e Esc não faz nada.  <!-- VID-27 -->

**Independent Test**: Colar o código do vídeo, que tem `processar_pedido`, `calcular_frete` e as chamadas `validar_pedido`, `db.salvar` e `enviar_email`. O primeiro nível deve mostrar GATILHO, FUNÇÃO, BANCO e E-MAIL ligados por fios no canvas escuro. Um clique em `calcular_frete` deve mostrar HTTP, SE e dois RETORNO, com "sim" em cima e "não" embaixo. Clicar de novo em cada nó com "›" deve descer até chegar só a folhas. "Voltar" deve subir um nível por vez até o Fluxo principal, com o nó de onde se veio selecionado.

---

### P2: O detalhe de um passo

**User Story**: Como desenvolvedor, quero abrir um passo de dentro de uma função e ler o que ele faz, para não ter que ler o código.

**Why P2**: O vídeo mostra resumo em todos os níveis. Hoje só funções têm resumo.

**Acceptance Criteria**:

1. WHEN o usuário abre um passo de dentro de uma função (HTTP, BANCO, DISCO, E-MAIL, EXTERNO, SE, LAÇO, BLOCO, CÓDIGO ou RETORNO) THEN the system SHALL pedir e mostrar um resumo de no máximo 2 frases em PTS, com a mesma revisão e o mesmo cache dos resumos de função.  <!-- VID-28 -->
2. WHEN o painel mostra um resumo THEN the system SHALL usar esta ordem de seções: "O QUE FAZ · PORTUGUÊS TÉCNICO SIMPLIFICADO", o resumo, a linha "2 frases · voz ativa · um termo por conceito" (só para passos), "CÓDIGO · <arquivo>, linhas X a Y" com o código numerado, e "ENTRADA E SAÍDA".  <!-- VID-29 -->
3. WHEN o resumo tem entradas e saídas THEN the system SHALL mostrar a seção "ENTRADA E SAÍDA" como as entradas, uma seta "→" e as saídas, em DM Mono.  <!-- VID-30 -->

**Independent Test**: Abrir o passo HTTP de `calcular_frete`. O painel deve mostrar um resumo de até 2 frases, o código das linhas do passo e "cep → uf".

---

### P3: Sugestões no canvas

**User Story**: Como desenvolvedor, quero ver as sugestões em cima dos nós, para saber onde melhorar sem abrir uma lista.

**Why P3**: É a última cena de produto do vídeo e depende do P1.

**Acceptance Criteria**:

1. WHEN um nó aberto recebe sugestões THEN the system SHALL mostrar cada sugestão como um cartão claro (`#F5F2EC` com texto `#121110`) no canvas, preso ao nó do nível visível cujas linhas contêm a linha da sugestão. Sem esse nó, o cartão fica preso ao próprio nó aberto. O texto do cartão é o comando da sugestão.  <!-- VID-31 -->
2. WHILE há cartões de sugestão no nível visível the system SHALL desenhar a borda `#D4FF3F` nos nós com cartão e mostrar os outros nós com 55% de opacidade.  <!-- VID-32 -->
3. WHEN o usuário clica num cartão de sugestão THEN the system SHALL abrir o painel do nó e marcar a linha da sugestão no código.  <!-- VID-33 -->

**Independent Test**: Abrir o GATILHO de `processar_pedido`. As sugestões sobre `db.salvar` e `enviar_email` devem aparecer como cartões em cima dos nós BANCO e E-MAIL do fluxo principal.

---

## Edge Cases

- WHEN a entrada não tem nenhuma chamada THEN the system SHALL mostrar a linha só com o nó GATILHO.  <!-- VID-10 -->
- IF o pedido de títulos devolve um título para um nó que não está no nível THEN the system SHALL ignorar esse título.  <!-- VID-14 -->
- WHEN um passo abre e não tem entradas nem saídas THEN the system SHALL omitir a seção "ENTRADA E SAÍDA".  <!-- VID-30 -->
- WHEN uma função chama a si mesma e o usuário abre essa chamada THEN the system SHALL abrir o fluxo da mesma função mais uma vez, como um nível novo na trilha. A descida só continua quando o usuário clica.  <!-- VID-24 -->

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| VID-01..27 | P1: O mapa do vídeo | Design | Pending |
| VID-28..30 | P2: O detalhe de um passo | Design | Pending |
| VID-31..33 | P3: Sugestões no canvas | Design | Pending |

**Coverage:** 33 total, 0 mapped to tasks.

---

## Success Criteria

- [ ] Uma página lado a lado mostra cada quadro do vídeo junto do print do app com o mesmo código, e o usuário aprova. São 5 quadros: "Cole o código", "O mapa", "Dentro do nó", "O detalhe" e "Sugestões".
- [ ] O Playwright compara prints dessas 5 telas com imagens de referência aprovadas pelo usuário, e cada requisito VID tem um teste E2E.
- [ ] Os testes de 01, 02 e 04 continuam passando, ou são atualizados quando esta spec muda o comportamento (por exemplo, o nó "Módulo" e os nomes dos passos).
