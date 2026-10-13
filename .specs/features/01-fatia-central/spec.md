# Fatia Central (trecho → mapa → drill-down → explicação) Specification

## Problem Statement

Ler código, principalmente código gerado por IA, leva mais tempo do que escrevê-lo. Falta uma vista que comece ampla, mostre como as partes se conectam e deixe descer até as linhas reais.

Esta feature entrega a menor fatia demonstrável do code2n8n:
- colar um trecho Python;
- ver as funções como nós e fios;
- abrir um nó até o código;
- ler um resumo em Português Técnico Simplificado com sugestões.

## Goals

- [ ] O exemplo de pedidos e frete do vídeo de conceito vira um mapa com drill-down, sem LLM.
- [ ] Abrir um nó mostra resumo e sugestões, e abrir o mesmo nó de novo não gera nova cobrança.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Pasta local / projeto inteiro | Feature 02-pasta-local. |
| Modo grafo (estilo Obsidian) | Feature 03-modo-grafo. |
| Linguagens além de Python | O extrator fica plugável (AD-003), mas o MVP é só Python. |
| Tour em vídeo (degrau 4) | Fase futura. |
| Edição ou execução do código analisado | O produto serve para entender o código. Só faz análise estática. |
| Exportar para workflow n8n | Não é migração. |

**Deferred** (a fatia funciona sem estes itens):

- Concorrência: limite de chamadas simultâneas ao LLM. Adiado porque um usuário local abre um nó por vez.
- Duplicidade: juntar pedidos iguais em andamento. Adiado porque o cache já cobre o caso comum.
- Observabilidade: log JSONL de chamadas e custos. Adiado porque o painel do OpenRouter mostra o uso.
- Falha externa: ajuste fino de novas tentativas e espera. Adiado porque o botão "Tentar de novo" cobre o MVP.
- Qualidade: pedir de novo um resumo fora do PTS. Adiado até medir com que frequência isso acontece.
- Limites de entrada: tamanho máximo do trecho e truncamento do código enviado ao LLM. Adiado porque o trecho é colado à mão.
- Escala: agrupar níveis com muitos nós. Adiado porque um trecho colado é pequeno.

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Linguagem | Python 3 | Resposta do usuário. | y |
| Forma do app | Web local: servidor Node só em `127.0.0.1` e front React | Resposta do usuário. Mesma stack do roadmap (AD-004). | y |
| Sugestões no MVP | Sim, na mesma chamada do resumo | Resposta do usuário. Uma chamada só custa menos. | y |
| Modelo | `~deepseek/deepseek-v4-flash-latest`, trocável por `CODE2N8N_MODEL` | Tier barato já usado no roadmap (AD-002). | y |
| Origem da chave | `OPENROUTER_API_KEY` num `.env` do code2n8n, copiada do roadmap e ignorada pelo git | O usuário pediu para usar a chave do roadmap. | n |
| Quando chamar o LLM | Só ao abrir o detalhe de um nó de função ou classe | Controla o custo. | n |
| Chave do cache | Hash do código do nó + modelo + versão do prompt, em disco, sem expiração | Código mudou → nova chamada. | n |
| Agrupamento de passos | Instruções seguidas sem chamada e sem controle de fluxo viram um nó "Código" | Evita um nó por linha. | n |
| Classificação de chamadas externas | Tabela de prefixos: HTTP (`requests`, `httpx`, `urllib`, `aiohttp`), BANCO (`sqlite3`, `psycopg`, `sqlalchemy`, `.execute(`, `.commit(`), ARQUIVO (`open`, `pathlib`), E-MAIL (`smtplib`). O resto é EXTERNO. | Determinístico e extensível. | n |

**Open questions:** none. Todas foram resolvidas ou registradas acima.

---

## User Stories

### P1: Entender um trecho colado, do mapa até a linha ⭐ MVP

**User Story**: Como desenvolvedor, quero colar um trecho Python, ver o fluxo como nós e fios, abrir qualquer nó até o código e ler um resumo com sugestões, para entender o trecho sem ler linha por linha.

**Why P1**: É a fatia central do produto. Todas as outras features ficam em cima dela.

**Acceptance Criteria** (each line is one EARS pattern):

*Mapa*

1. WHEN o usuário cola um trecho Python e aciona "Gerar mapa" THEN o sistema SHALL mostrar um nó para cada função e classe de nível superior.  <!-- CORE-01 -->
2. WHEN uma função A chama uma função B definida no trecho THEN o sistema SHALL desenhar um fio de A para B.  <!-- CORE-02 -->
3. WHEN o trecho tem instruções fora de funções THEN o sistema SHALL agrupá-las num nó "Módulo".  <!-- CORE-03 -->
4. The system SHALL produzir o mesmo grafo, com os mesmos IDs de nó, para o mesmo trecho.  <!-- CORE-04 -->
5. The system SHALL montar o grafo sem chamar o LLM.  <!-- CORE-05 -->
6. IF o trecho tem erro de sintaxe THEN o sistema SHALL montar o grafo com as partes válidas e marcar o nó afetado com "Erro de sintaxe na linha N".  <!-- CORE-06 -->
7. IF o trecho não tem função nem instrução THEN o sistema SHALL mostrar "Nenhuma função ou instrução encontrada."  <!-- CORE-07 -->

*Drill-down*

8. WHEN o usuário abre um nó de função THEN o sistema SHALL mostrar os passos internos na ordem do código.  <!-- CORE-08 -->
9. WHEN um passo é um `if`/`elif`/`else` THEN o sistema SHALL mostrar um nó de condição com um fio rotulado por ramo ("sim", "não" ou a condição do `elif`).  <!-- CORE-09 -->
10. WHEN um passo é um `for` ou `while` THEN o sistema SHALL mostrar um nó de laço que pode ser aberto para ver o corpo.  <!-- CORE-10 -->
11. WHEN o usuário abre um passo que chama uma função do trecho THEN o sistema SHALL mostrar o fluxo interno da função chamada.  <!-- CORE-11 -->
12. WHEN um passo chama uma biblioteca externa THEN o sistema SHALL classificar o nó como HTTP, BANCO, ARQUIVO, E-MAIL ou EXTERNO pela tabela de prefixos.  <!-- CORE-12 -->
13. WHEN instruções seguidas não têm chamada nem controle de fluxo THEN o sistema SHALL agrupá-las num nó "Código" com o intervalo de linhas.  <!-- CORE-13 -->
14. WHEN o usuário seleciona um nó THEN o sistema SHALL mostrar o intervalo de linhas e o código-fonte exato do nó.  <!-- CORE-14 -->
15. WHILE o usuário está dentro de um nó the system SHALL mostrar o caminho de navegação e voltar a qualquer nível com um clique.  <!-- CORE-15 -->

*Explicação*

16. WHEN o usuário abre o detalhe de um nó de função ou classe THEN o sistema SHALL pedir ao LLM, numa única chamada, o resumo, as entradas, as saídas e de 0 a 5 sugestões, com as regras de [docs/portugues-tecnico-simplificado.md](../../../docs/portugues-tecnico-simplificado.md) como instrução de sistema.  <!-- CORE-16 -->
17. The system SHALL enviar ao LLM só o código do nó e os nomes dos vizinhos diretos.  <!-- CORE-17 -->
18. WHEN um nó já explicado é aberto de novo, com o mesmo código, modelo e versão de prompt THEN o sistema SHALL usar o cache em disco e não SHALL chamar o LLM.  <!-- CORE-18 -->
19. IF `OPENROUTER_API_KEY` não está definida THEN o sistema SHALL mostrar o mapa normalmente e "Configure OPENROUTER_API_KEY para ver resumos" no painel do nó.  <!-- CORE-19 -->
20. IF a chamada ao LLM falha THEN o sistema SHALL mostrar "Resumo indisponível" com um botão "Tentar de novo", e o mapa SHALL continuar utilizável.  <!-- CORE-20 -->
21. The system SHALL usar o modelo de `CODE2N8N_MODEL` ou, sem a variável, `~deepseek/deepseek-v4-flash-latest`.  <!-- CORE-21 -->
22. IF uma sugestão aponta uma linha fora do intervalo do nó THEN o sistema SHALL descartá-la.  <!-- CORE-22 -->
23. WHEN um nó tem sugestões THEN o sistema SHALL mostrar no nó um selo com a quantidade.  <!-- CORE-23 -->
24. WHEN o usuário clica numa sugestão THEN o sistema SHALL destacar a linha de origem no código do nó.  <!-- CORE-24 -->

**Independent Test**: Colar o exemplo `processar_pedido` / `calcular_frete`. O teste passa quando:
1. aparecem dois nós com um fio entre eles;
2. ao abrir `calcular_frete`, aparecem HTTP → Código → condição "peso > 30" com dois ramos;
3. ao selecionar o nó HTTP, aparecem as linhas do `requests.get`;
4. ao abrir o detalhe, aparecem um resumo em PTS e uma sugestão que aponta para essa linha;
5. ao reabrir o nó, a resposta sai do cache e não há nova chamada.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| CORE-01..07 | P1: Mapa | - | Pending |
| CORE-08..15 | P1: Drill-down | - | Pending |
| CORE-16..24 | P1: Explicação | - | Pending |

**Coverage:** 24 total, 0 mapped to tasks.

---

## Success Criteria

- [ ] O exemplo do vídeo de conceito funciona do começo ao fim, como descrito no Independent Test.
- [ ] Nenhuma sugestão exibida aponta uma linha fora do nó.
- [ ] Trocar o modelo exige mudar só `CODE2N8N_MODEL`.
