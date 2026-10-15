# Pasta Local Specification

## Problem Statement

A fatia central só entende trechos colados. Para ter a visão de um projeto inteiro, o usuário precisa apontar uma pasta e ver pastas, arquivos e funções conectados por imports e chamadas.

Depende de: 01-fatia-central.

## Goals

- [ ] Uma pasta Python real vira um mapa com pastas → arquivos → funções, usando o mesmo drill-down e a mesma explicação da fatia central.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Repositórios remotos (URL do GitHub) | Entrada só por pasta local. |
| Resolver imports dinâmicos (`importlib`, `__import__`) | Impossível de forma determinística. A chamada aparece como EXTERNO. |
| Atualizar o mapa sozinho quando os arquivos mudam | O usuário gera o mapa de novo. |

**Deferred** (a fatia funciona sem estes itens):

- Limites de entrada: número máximo de arquivos e de MB por pasta. Adiado até medir o tempo real numa pasta grande.
- Codificação: arquivos fora de UTF-8 tratados como latin-1. Adiado porque eles entram em "Arquivos ignorados" pelo PROJ-06.
- Links simbólicos que saem da pasta. Adiado porque o sistema só lê arquivos (PROJ-07) e o servidor é local (PROJ-08).
- Escala: agrupar níveis com mais de N nós. Adiado até ver um caso real.

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Pastas ignoradas | `.git`, `.venv`, `venv`, `node_modules`, `__pycache__`, `site-packages`, `build`, `dist` | Não são código do projeto. | n |
| Arquivo grande | Arquivos acima de 1 048 576 bytes entram em "Arquivos ignorados" | Costumam ser gerados, não escritos à mão. | y |
| Leitura de qualquer caminho local | A API local lê qualquer pasta que o usuário informar, sem limite de tamanho total | App local de um usuário. Navegadores ficam bloqueados pela guarda de `Host` e pelo 415. Outros processos locais conseguem ler, e esse risco é aceito. | y |
| Nível superior | Uma subpasta (pacote) por nó, mais os arquivos da raiz, cada um como nó. | Espelha a estrutura do projeto. | n |

**Open questions:** none. Todas foram resolvidas ou registradas acima.

---

## User Stories

### P1: Mapa de um projeto a partir de uma pasta ⭐ MVP

**User Story**: Como desenvolvedor, quero informar o caminho de uma pasta e ver pastas, arquivos e funções conectados, para entender o projeto inteiro.

**Why P1**: Sem isso a ferramenta só serve para trechos isolados.

**Acceptance Criteria** (each line is one EARS pattern):

1. WHEN o usuário informa o caminho de uma pasta THEN o sistema SHALL ler todos os arquivos `.py` da pasta e das subpastas, exceto as pastas ignoradas.  <!-- PROJ-01 -->
2. WHEN a leitura termina THEN o sistema SHALL mostrar um nó por subpasta e um nó por arquivo da raiz no nível superior, e um nó por arquivo dentro de cada subpasta.  <!-- PROJ-02 -->
3. WHEN um arquivo importa outro arquivo da mesma raiz THEN o sistema SHALL desenhar uma aresta de importação entre eles.  <!-- PROJ-03 -->
4. WHEN uma função chama uma função de outro arquivo da raiz por um import resolvido THEN o sistema SHALL desenhar a aresta de chamada entre as duas funções.  <!-- PROJ-04 -->
5. IF o caminho não existe ou não é uma pasta THEN o sistema SHALL mostrar "Pasta não encontrada: <caminho>".  <!-- PROJ-05 -->
6. IF um arquivo não pode ser lido, passa de 1 MB, não está em UTF-8 ou é um link simbólico THEN o sistema SHALL ignorá-lo e listá-lo em "Arquivos ignorados" como "<caminho> — <motivo>". Os motivos são exatamente "maior que 1 MB", "não está em UTF-8", "não foi possível ler" e "link simbólico não seguido". 1 MB são 1 048 576 bytes: um arquivo com exatamente esse tamanho entra no mapa, e um com 1 byte a mais é ignorado.  <!-- PROJ-06 -->
7. The system SHALL só ler arquivos e nunca SHALL escrever, mover ou executar arquivos da pasta analisada.  <!-- PROJ-07 -->
8. The system SHALL escutar só no endereço IPv4 `127.0.0.1`. O nome `localhost` funciona quando resolve para esse endereço. O IPv6 `::1` e as interfaces de rede externas não são escutados.  <!-- PROJ-08 -->
9. WHEN dois arquivos definem funções com o mesmo nome THEN o sistema SHALL resolver a chamada pelo import do arquivo chamador e, sem import, SHALL classificá-la como EXTERNO. Uma chamada pontuada para um módulo do projeto que o arquivo não importou (`frete.calcular()` sem `import frete`) também não ganha aresta de chamada.  <!-- PROJ-09 -->

**Independent Test**: Apontar uma pasta com `pedidos/` e `frete/` em que `pedidos` importa `frete`. Devem aparecer dois nós de pasta com uma aresta de importação entre eles. Abrindo `pedidos`, a aresta de chamada deve chegar a `calcular_frete`.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| PROJ-01..09 | P1: Pasta local | Execute | Verified |

**Coverage:** 9 total, 9 mapped to tasks, 9 verified (validation.md, iteração 3).

---

## Success Criteria

- [ ] Uma pasta Python real do usuário vira um mapa navegável sem nenhuma mudança nos arquivos dela.
- [ ] Drill-down, resumos e sugestões funcionam igual à fatia central.
