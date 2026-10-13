# Modo Grafo Specification

## Problem Statement

O modo fluxo responde "o que acontece, em que ordem". Ele não mostra bem quais funções são centrais, quais estão isoladas e como o código se agrupa.

Um modo grafo de forças, no estilo Obsidian, sobre o mesmo modelo de dados responde a essas perguntas.

Depende de: 01-fatia-central. Fica mais útil com 02-pasta-local.

## Goals

- [ ] O usuário alterna entre fluxo e grafo sem perder o nó selecionado.
- [ ] Funções centrais e possível código morto ficam visíveis sem ler código.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Detecção automática de comunidades (clustering) | A cor por arquivo ou pasta já mostra os grupos no MVP. |
| Filtros e busca no grafo | Feature futura, depois de usar o modo grafo. |

**Deferred** (a fatia funciona sem estes itens):

- Escala: desempenho com milhares de nós. Adiado até medir num projeto real.

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Nós do grafo | Só nós de função e método. Fios só de chamada. | É o nível em que hubs e código morto fazem sentido. | n |
| Pontos de entrada | `if __name__ == "__main__"`, instruções de nível de módulo e funções com decorador (rotas, CLIs, tarefas) | Funções que ninguém chama no código, mas que um framework chama. | n |

**Open questions:** none. Todas foram resolvidas ou registradas acima.

---

## User Stories

### P1: Ver o código como grafo de forças ⭐ MVP

**User Story**: Como desenvolvedor, quero ver o mesmo código como um grafo de forças, para achar funções centrais, código isolado e grupos.

**Why P1**: É a única história desta feature.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN o usuário troca do modo fluxo para o modo grafo THEN o sistema SHALL desenhar todos os nós de função e os fios de chamada num layout de forças.  <!-- GRAPH-01 -->
2. The system SHALL dimensionar cada nó pelo número de conexões de entrada e saída.  <!-- GRAPH-02 -->
3. The system SHALL colorir cada nó pelo arquivo de origem.  <!-- GRAPH-03 -->
4. WHEN um nó está selecionado e o usuário troca de modo THEN o sistema SHALL manter o mesmo nó selecionado e centralizado.  <!-- GRAPH-04 -->
5. WHEN uma função não é chamada por nenhuma outra e não é ponto de entrada THEN o sistema SHALL marcá-la como "sem chamadas: possível código morto".  <!-- GRAPH-05 -->
6. WHEN o usuário passa o cursor sobre um nó THEN o sistema SHALL destacar o nó e os vizinhos diretos e esmaecer os demais.  <!-- GRAPH-06 -->
7. WHEN o usuário dá duplo clique num nó THEN o sistema SHALL abrir o fluxo interno desse nó no modo fluxo.  <!-- GRAPH-07 -->

**Independent Test**: Num trecho com uma função que ninguém chama, trocar para o modo grafo. A função deve aparecer marcada como possível código morto. Dando duplo clique nela, o fluxo interno dela deve abrir.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| GRAPH-01..07 | P1: Modo grafo | - | Pending |

**Coverage:** 7 total, 0 mapped to tasks.

---

## Success Criteria

- [ ] Alternar entre os modos mantém a seleção em 100% dos casos.
- [ ] Uma função órfã aparece marcada sem nenhuma ação do usuário.
