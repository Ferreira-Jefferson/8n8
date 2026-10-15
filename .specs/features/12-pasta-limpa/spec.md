# Pasta limpa Specification

## Problem Statement

Ao abrir a pasta do próprio 8n8, o mapa mostrou "Arquivos ignorados" com um arquivo de `apps/vscode/.vscode-test`, a cópia do VS Code que o teste da extensão baixa. Três problemas apareceram:

1. O 8n8 lê pastas que o projeto declara como fora do código (o `.gitignore`), e mostra os arquivos delas.
2. A lista de arquivos ignorados é um texto solto sobre o mapa: um caminho longo passa por cima do painel. E um arquivo grande não tem como entrar no mapa quando a pessoa quer vê-lo.
3. O histórico guarda o código inteiro de cada pasta mapeada. Uma pasta já está no disco: basta guardar o caminho.

Depende de: 02-pasta-local, 07-cli.

## Done When

Ao abrir a pasta do 8n8, nada de `.vscode-test`, `node_modules` nem `dist` aparece. Um arquivo maior que 1 MB vira um ícone de aviso; o hover diz quantos arquivos ficaram fora, o clique lista os arquivos e deixa pôr um arquivo grande no mapa. O histórico de uma pasta guarda só o caminho, e abrir pelo histórico lê a pasta de novo.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Ler o `~/.gitignore` global e o `.git/info/exclude` | São configurações da máquina, não do projeto. O mapa da mesma pasta seria diferente em outra máquina. |
| Pôr no mapa um arquivo binário, ilegível ou link simbólico | O arquivo não é código legível. |
| Lembrar entre sessões quais arquivos grandes a pessoa pôs no mapa | O histórico guarda só o caminho (pedido do usuário). |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Quais `.gitignore` valem | O da raiz da pasta e o de cada subpasta, com as regras do git (pacote `ignore`) | É o que o git faz dentro do projeto. | y |
| Pasta sem `.gitignore` | Igual a hoje | Só as pastas fixas e as de cada linguagem ficam de fora. | y |
| Limite de um arquivo posto no mapa pelo clique | 20 MB. Acima disso, o arquivo fica na lista sem a opção | Um arquivo enorme trava a tela e o parser. | y |
| O que o histórico guarda de um trecho | O texto do trecho, sem o grafo | Um trecho não tem caminho: o texto é a única coisa que permite reabri-lo. O grafo sai do texto de novo ao abrir. | y |
| Histórico antigo | A migração apaga o código e o grafo guardados e mantém uma linha por caminho | Os dados guardados deixam de existir, como pedido. | y |

**Open questions:** none.

---

## User Stories

### P1: O mapa só tem o código do projeto ⭐ MVP

**Acceptance Criteria**:

1. WHEN o 8n8 lê uma pasta THEN ele SHALL pular todo arquivo e toda pasta que o `.gitignore` da raiz ou de uma subpasta ignora, com as regras do git (padrões, `!`, `/` no fim e no começo, `**`).  <!-- CLEAN-01 -->
2. The arquivos pulados pelo `.gitignore` nunca SHALL aparecer no mapa nem na lista de arquivos ignorados.  <!-- CLEAN-02 -->
3. The README SHALL dizer que o 8n8 respeita o `.gitignore` da pasta, e o que mais ele pula.  <!-- CLEAN-03 -->

**Independent Test**: uma pasta com `.gitignore` listando `gerado/` e `*.log.py` mapeia sem esses arquivos, e sem nenhum deles na lista de ignorados.

---

### P1: Arquivos ignorados num ícone, com a opção de pôr no mapa

**Acceptance Criteria**:

1. WHEN a leitura deixa arquivos fora THEN a tela SHALL mostrar um ícone de aviso, sem texto sobre o mapa, cujo hover diz "N arquivos ignorados" (ou "1 arquivo ignorado"). Sem arquivo fora, nada SHALL aparecer.  <!-- CLEAN-04 -->
2. WHEN a pessoa clica no ícone THEN a tela SHALL abrir uma lista com cada arquivo e o motivo, dentro de uma caixa que não passa por cima do painel de detalhe (caminhos longos quebram linha).  <!-- CLEAN-05 -->
3. WHEN um arquivo ficou fora por ser maior que 1 MB e tem até 20 MB THEN a lista SHALL mostrar o botão "Adicionar ao mapa". WHEN a pessoa clica nele THEN a tela SHALL pedir a pasta de novo com esse arquivo incluído, e o arquivo SHALL entrar no mapa e sair da lista.  <!-- CLEAN-06 -->
4. The pedidos da mesma pasta (resumo, sugestões e títulos) SHALL levar os arquivos incluídos, para o servidor ler a mesma pasta que a tela mostra (AD-015). The servidor SHALL aceitar no máximo 100 caminhos incluídos, relativos, sem `..`, sem `\` e sem começar com `/`, e responder 400 a qualquer outro.  <!-- CLEAN-07 -->

---

### P1: O histórico guarda só o caminho

**Acceptance Criteria**:

1. WHEN o histórico guarda uma pasta THEN ele SHALL guardar só o caminho, o nome e os números da lista (linhas, bytes, arquivos, nós, fios), nunca o código nem o grafo. WHEN guarda um trecho THEN ele SHALL guardar só o texto do trecho e a linguagem.  <!-- CLEAN-08 -->
2. WHEN a pessoa abre uma pasta pelo histórico THEN a tela SHALL ler a pasta de novo pelo caminho; IF a pasta não existe mais THEN a tela SHALL mostrar "Pasta não encontrada: <caminho>". WHEN abre um trecho THEN a tela SHALL gerar o mapa do texto de novo.  <!-- CLEAN-09 -->
3. WHEN o 8n8 abre um banco de histórico antigo THEN a migração SHALL apagar todo código e grafo guardados e deixar uma linha por caminho de pasta (a aberta por último), sem perder favoritos.  <!-- CLEAN-10 -->

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| CLEAN-01..03 | P1: O mapa só tem o código do projeto | Verified |
| CLEAN-04..07 | P1: Arquivos ignorados num ícone | Verified |
| CLEAN-08..10 | P1: O histórico guarda só o caminho | Verified |
