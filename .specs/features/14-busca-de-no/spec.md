# Busca de nó Specification

## Problem Statement

Num mapa grande, achar uma função exige abrir nível por nível. A LLM também reescreve o título do nó (a função `cadastro_produto` vira "Cadastro de produtos"), e a pessoa lembra de um nome ou do outro. Falta uma forma de ir direto ao nó, sem ocupar a tela com um campo aberto.

Depende de: 05-mapa-do-video (níveis, títulos, seleção). Referência visual: `docs/marca/manual.html`, seção Componentes, "Busca de nó".

## Done When

Na tela do mapa há uma lupa no canto superior direito. Ao clicar, ela vira um campo que cresce. A busca acha um nó pelo título ou pelo nome técnico, em qualquer nível. Ao escolher um resultado, o mapa abre o caminho até o nó, centraliza e seleciona.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Buscar dentro do código das linhas | A busca é de nós com nome (pasta, arquivo, função, classe, laço, bloco). |
| Título revisado de um nível ainda não aberto | O título só existe depois que o nível é aberto. Até lá a busca usa o nome provisório, feito do nome técnico. |
| Buscar na tela inicial e no editor | A busca vive no mapa. |
| Calls, retornos, condições e trechos soltos | Repetem o nome de uma função ou não têm nome. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| De onde vêm os nós de todos os níveis | Do grafo completo, que o cliente já tem (`graph.nodes`) | Pasta e trecho chegam inteiros. Não precisa do servidor. | y |
| Um nó que o nível do pai não mostra (função chamada, que não é entrada do trecho) | Abre o nível do próprio nó e seleciona o nó (o hub) | É o único jeito de chegar nela, como o clique numa chamada. | n |
| Campo vazio | Lista os primeiros 50 nós | Segue o manual. | n |
| Máximo de resultados | 50 | A lista rola. | n |

**Open questions:** none.

---

## User Stories

### P1: Achar e ir até um nó

**Acceptance Criteria**:

1. WHEN o mapa está aberto THEN a tela SHALL mostrar um botão de lupa ("Buscar nó"), 60x60 px, no canto superior direito, à esquerda de "Configurações" e de "Histórico", com o mesmo botão `btn-ghost` deles. A tela inicial e o editor SHALL NOT mostrar a lupa.  <!-- BUSCA-01 -->
2. WHEN a pessoa clica na lupa THEN o campo SHALL crescer para a esquerda em 200 ms, `ease-out`, com a lupa na borda direita e o foco no campo (placeholder "Título ou nome da função"). WHEN a pessoa aperta Esc ou clica fora THEN a busca SHALL fechar e limpar o campo, e o Esc SHALL NOT subir de nível. WHEN `prefers-reduced-motion: reduce` está ligado THEN o campo SHALL abrir sem animação.  <!-- BUSCA-02 -->
3. WHEN a pessoa digita THEN a busca SHALL ignorar maiúsculas, acentos e a diferença entre espaço, `_` e `-`, e SHALL listar o nó cujo texto "título + nome técnico" contém cada palavra digitada, no título ou no nome técnico. O nó SHALL ser achado pelo título revisado pela LLM e também pelo nome técnico.  <!-- BUSCA-03 -->
4. WHEN há resultados THEN cada um SHALL mostrar o título em negrito, o nome técnico em mono embaixo e, à direita, arquivo e linhas (pasta e arquivo mostram o tipo), com o trecho achado em `<mark>`. WHEN não há resultado THEN a lista SHALL dizer "Nenhum nó achado.". As setas SHALL mover o realce, Enter SHALL escolher o realçado (o primeiro, se nenhum), e os papéis ARIA SHALL ser combobox, listbox e option.  <!-- BUSCA-04 -->
5. WHEN a pessoa escolhe um resultado THEN a busca SHALL fechar, abrir cada nível da hierarquia até o nó (ou subir, se o nó é de um nível acima), selecionar o nó (borda Petróleo, painel de detalhe) e mostrá-lo no canvas. WHEN o nó é de um nível que o pai não mostra THEN a busca SHALL abrir o nível do próprio nó.  <!-- BUSCA-05 -->
6. WHEN o nó escolhido já está no nível aberto THEN o canvas SHALL centralizá-lo, no zoom atual. WHEN o nó está em outro nível THEN o nível novo SHALL abrir com o nó o mais perto possível do meio.  <!-- BUSCA-06 -->

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| BUSCA-01..06 | P1: Achar e ir até um nó | Implemented |
