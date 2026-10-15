# Início sem pasta Specification

## Problem Statement

Na extensão, "8n8: Abrir mapa" carregou a pasta da área de trabalho sem a pessoa pedir uma pasta. No mapa de uma pasta, "Voltar" fica desligado no nível de cima, e a única saída para a tela inicial é o botão "Novo código", que não diz que leva ao início. A pessoa ficou presa no mapa.

Depende de: 10-extensao-vscode. Muda o VSC-01.

## Done When

"8n8: Abrir mapa" abre a tela inicial, sem mapa. Só um pedido explícito de pasta (o menu do Explorer, `8n8 <pasta>` na CLI ou a tela inicial) abre um mapa. Todo mapa de pasta tem um botão "Início" que volta à tela inicial, na web, na CLI e na extensão.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Preencher o campo da tela inicial com a pasta da área de trabalho | Não foi pedido. Fica como sugestão. |
| Um botão "Início" no mapa de um trecho | "Novo código" volta ao texto, e o editor já tem "Início". |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| O que abre a paleta sem pasta aberta | A tela inicial, sem diálogo | A tela inicial já tem o campo da pasta. | n |
| O nome do botão no mapa de pasta | "Início", no lugar de "Novo código" | O botão já levava à tela inicial; só o nome enganava. O editor usa o mesmo nome. | n |

**Open questions:** none.

---

## User Stories

### P1: Só abre um mapa quem pede

**Acceptance Criteria**:

1. WHEN o usuário roda "8n8: Abrir mapa" na paleta THEN a extensão SHALL abrir o painel "8n8" na tela inicial, sem pedir mapa de pasta nenhuma, com ou sem pasta na área de trabalho.  <!-- HOME-01 -->
2. WHEN o usuário escolhe "8n8: Abrir mapa desta pasta" no Explorer THEN a extensão SHALL abrir o mapa dessa pasta, como antes.  <!-- HOME-02 -->
3. WHEN um mapa de pasta está aberto THEN a tela SHALL mostrar o botão "Início", e não "Novo código". WHEN a pessoa clica nele THEN a tela SHALL voltar à tela inicial com o caminho da pasta no campo, em qualquer nível do mapa.  <!-- HOME-03 -->
4. WHEN um mapa de trecho está aberto THEN a tela SHALL manter "Novo código", que volta ao texto.  <!-- HOME-04 -->

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| HOME-01..04 | P1: Só abre um mapa quem pede | Verified |
