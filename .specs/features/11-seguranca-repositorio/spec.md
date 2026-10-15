# Segurança do repositório Specification

## Problem Statement

O 8n8 vai para a comunidade, e um projeto aberto recebe pull requests de terceiros. As guardas das features 07 a 10 só protegem quem roda os testes: sem CI, um PR que apaga uma guarda ou traz um segredo passa se ninguém rodar `pnpm check` e `pnpm test`. O `CODEOWNERS` (DIST-24) só bloqueia o merge com a proteção de branch ligada. A verificação da 07 também deixou um limite conhecido: o `node:cluster` inicia outro processo Node sem citar `child_process`.

Esta feature traz para o repositório tudo o que roda do lado do GitHub, pronto para ligar: CI, CodeQL, Dependabot, a política de segurança e os passos da proteção de branch. Enviar esses arquivos e ligar as regras no GitHub são ações externas e ficam para o dono do projeto.

Depende de: 07-cli, 10-extensao-vscode.

## Done When

O repositório tem os workflows de CI e CodeQL, a config do Dependabot e o `SECURITY.md`, e um teste falha se a CI deixa de rodar um dos gates ou usa uma action sem SHA fixo. Depois do push e da proteção de branch, um PR só entra com a CI verde e a revisão do dono nos arquivos de segurança.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Fazer push e ligar a proteção de branch, o "private vulnerability reporting" e o Dependabot no GitHub | Ações externas. O `SECURITY.md` lista os passos, e o dono do projeto os faz quando decidir abrir o repositório. |
| Rodar o teste de integração do VS Code na CI | Ele precisa de tela (Electron). Fica no ambiente do contribuidor (`pnpm --filter 8n8-vscode test:integration`). |
| Assinatura de commits e de releases | Sem release publicada ainda. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Onde a CI roda | `ubuntu-latest`, Node 22 (o mínimo do projeto) | Um sistema basta para o gate. O autor roda o Windows localmente. | y |
| Versões das actions | Fixadas por SHA de commit, com a tag num comentário, e só versões com 14 dias ou mais | Uma tag pode mudar de dono do código; um SHA não. | y |
| Segredos na CI | Só o `GITHUB_TOKEN`, com `permissions: contents: read` no topo | O E2E usa o LLM falso; nenhuma chave real entra na CI. | y |
| Gatilhos | `pull_request` e `push` na `main`; nunca `pull_request_target` | `pull_request_target` roda código do PR com acesso de escrita. | y |

**Open questions:** none.

---

## User Stories

### P1: A CI barra um PR que enfraquece o projeto ⭐ MVP

**User Story**: Como dono do projeto, quero que todo PR rode os mesmos gates que eu rodo, para que nenhuma guarda saia e nenhum segredo entre sem eu ver.

**Acceptance Criteria**:

1. The repositório SHALL ter `.github/workflows/ci.yml`, disparado por `pull_request` e por `push` na `main`, que roda `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm check`, `pnpm test` e `pnpm e2e`, e o gitleaks sobre todo o histórico.  <!-- SEC-01 -->
2. The workflows SHALL declarar `permissions: contents: read` no topo, nunca usar `pull_request_target`, e fixar cada action por um SHA de commit de 40 caracteres.  <!-- SEC-02 -->
3. The repositório SHALL ter `.github/workflows/codeql.yml`, que analisa JavaScript e TypeScript em `pull_request`, em `push` na `main` e uma vez por semana, com `security-events: write` só no job da análise.  <!-- SEC-03 -->
4. The repositório SHALL ter `.github/dependabot.yml` com atualizações semanais para `npm` (na raiz do workspace) e para `github-actions`.  <!-- SEC-04 -->
5. The teste do repositório SHALL falhar se um workflow perde um dos gates do SEC-01, usa uma action sem SHA, ganha permissão no topo ou usa `pull_request_target`.  <!-- SEC-05 -->

**Independent Test**: tirar o `pnpm check` do `ci.yml`, ou trocar um SHA por `@v7`, faz `pnpm test` falhar.

---

### P1: Política de segurança e o que falta ligar

**User Story**: Como pessoa que acha uma falha, quero saber como avisar sem expor os usuários. Como dono, quero a lista do que ligar no GitHub.

**Acceptance Criteria**:

1. The repositório SHALL ter `SECURITY.md` em Português Técnico Simplificado, com: como relatar uma falha em privado (o "private vulnerability reporting" do GitHub), o que conta como falha (uso da chave ou do Claude Code por terceiros, porta aberta, leitura fora da pasta, processo iniciado fora das exceções), a versão suportada e os passos da proteção de branch (PR obrigatório, CI obrigatória, revisão do `CODEOWNERS` obrigatória, sem force push).  <!-- SEC-06 -->
2. The `.github/CODEOWNERS` SHALL cobrir `.github/workflows/`, `.github/dependabot.yml` e `SECURITY.md`.  <!-- SEC-07 -->

---

### P1 (fecha o limite da 07): Nenhum outro jeito de iniciar processo

**Acceptance Criteria**:

1. The regra `no-child-process` SHALL recusar também `node:cluster`, com as mesmas exceções, e o teste das guardas SHALL provar isso com um arquivo que viola a regra.  <!-- SEC-08 -->

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| SEC-01..05 | P1: A CI barra um PR que enfraquece o projeto | Pending |
| SEC-06..07 | P1: Política de segurança | Pending |
| SEC-08 | P1: Nenhum outro jeito de iniciar processo | Pending |
