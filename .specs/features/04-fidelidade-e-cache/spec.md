# Fidelidade e Cache Specification

## Problem Statement

Na fatia central, o resumo do LLM pode inventar fatos e deixar de fora passos importantes. No teste real, ele inventou a unidade "kg", que não está no código, e não citou a chamada `requests.get`. Uma explicação que inventa destrói a confiança no produto inteiro.

O cache também tem uma falha: sua chave ignora os vizinhos do nó. Quando uma função vizinha muda de nome, o resumo guardado continua citando o nome antigo.

Depende de: 01-fatia-central.

## Goals

- [ ] Nenhuma frase exibida afirma algo que não está no código do nó ou nos nomes dos vizinhos.
- [ ] Toda frase exibida aponta as linhas que a sustentam.
- [ ] O cache detecta o que mudou (código, vizinhos, modelo ou prompt), atualiza o resumo e diz ao usuário o motivo.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Revisor de outro provedor ou humano | O revisor usa o mesmo gateway (AD-002). Um modelo diferente pode ser configurado. |
| Equivalência semântica de código (reformatação ≠ mudança) | Só espaços no fim da linha e quebras de linha são normalizados. Comparar a AST fica para depois. |
| Painel de custo das chamadas | O painel do OpenRouter já mostra o uso. |

**Deferred** (a feature funciona sem estes itens):

- Observabilidade: log das frases cortadas pelo revisor, para medir a taxa de invenção. Adiado até ter volume de uso.
- Limpeza dos arquivos de cache no formato da feature 01 (`<dir>/<chave>.json`), que ficam órfãos.
- Limpeza de entradas de nós que não existem mais em nenhum trecho. Adiado porque cada nó já tem no máximo 1 entrada (CACHE-06).

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Camadas de revisão | Duas camadas: (1) checagens determinísticas no código, sem LLM; (2) um revisor LLM que julga frase a frase e dá as linhas de evidência | A camada 1 pega invenções baratas e certas, como números, unidades e identificadores. A camada 2 pega afirmações que nenhuma regra fixa detecta. | y |
| Modelo do revisor | `APP8N8_REVIEW_MODEL`. Sem a variável, usa o mesmo modelo de `APP8N8_MODEL`. | O pedido é barato e não exige mais configuração. | n |
| O que é "frase" | Cada frase do resumo, cada entrada, cada saída e cada sugestão (o comando e o motivo juntos) | São todos os textos do LLM que o usuário vê. | n |
| Como as unidades casam | Unidades de uma letra (`g`, `t`, `m`, `l`, `s`, `h`) só contam logo depois de um número. As demais contam em qualquer lugar. A presença no código é checada por token inteiro, sem diferenciar maiúsculas, e identificadores são quebrados em `_` e na fronteira entre dígito e letra. Uma unidade de uma letra que aparece só dentro de uma palavra do código (`status`) não conta como presente. | Evita falso positivo em prosa comum e falso negativo por pedaço de texto. | y |
| Unidades checadas na camada 1 | `kg`, `g`, `mg`, `t`, `km`, `m`, `cm`, `mm`, `l`, `ml`, `R$`, `US$`, `€`, `%`, `ms`, `s`, `seg`, `segundos`, `min`, `minutos`, `h`, `horas`, `dias`, `KB`, `MB`, `GB` | São as unidades mais comuns. A lista é extensível. | n |
| Novas tentativas | No máximo 2 novos rascunhos, cada um com a lista de problemas encontrados | Mantém o custo limitado. | n |
| Identidade do nó no cache | O ID estrutural do nó (AD-006), por exemplo `fn:calcular_frete` | É estável entre trechos. Se dois trechos têm o mesmo nome com código diferente, a impressão digital resolve a diferença. | n |
| Vizinhos | Os nomes dos chamadores e dos chamados diretos, ordenados | É o mesmo contexto que o CORE-17 envia ao LLM. | n |
| Normalização do código | Remove espaços no fim de cada linha e converte CRLF em LF antes do hash | Mudar só o editor ou o sistema operacional não deve gerar nova cobrança. | n |
| Linhas no cache | Guardadas relativas ao início do nó e convertidas na leitura | O mesmo código em outra posição continua apontando as linhas certas. | n |
| Validação E2E | Os fluxos FID e CACHE são cobertos por testes Playwright no navegador real, contra o servidor real. O servidor aponta para um falso OpenRouter local (`OPENROUTER_BASE_URL`), que dá respostas roteirizadas e conta as chamadas, e usa um cache isolado (`APP8N8_CACHE_DIR`). Só a troca de modelo ou de prompt fica apenas em teste unitário, porque exige reiniciar o servidor. | Pedido do usuário: validar com Playwright o pipeline de verdade. | y |

**Open questions:** none. Todas foram resolvidas ou registradas acima.

---

## User Stories

### P1: Explicação fiel, revisada e com evidência ⭐ MVP

**User Story**: Como desenvolvedor, quero que cada frase do resumo e cada sugestão seja verificada no código e aponte as linhas que a sustentam, para confiar no que leio sem conferir tudo.

**Why P1**: Um resumo que inventa é pior do que nenhum resumo.

**Acceptance Criteria** (each line is one EARS pattern):

*Revisão*

1. The system SHALL passar todo rascunho do LLM pelas duas camadas de revisão antes de exibi-lo ou gravá-lo no cache.  <!-- FID-01 -->
2. IF uma frase contém um número que não aparece no código do nó THEN a camada 1 SHALL marcar a frase como "não suportada".  <!-- FID-02 -->
3. IF uma frase contém uma unidade da lista que não aparece no código do nó, nem em comentário nem em texto THEN a camada 1 SHALL marcar a frase como "não suportada".  <!-- FID-03 -->
4. IF uma frase cita entre crases um identificador que não existe no código do nó nem nos nomes dos vizinhos THEN a camada 1 SHALL marcar a frase como "não suportada".  <!-- FID-04 -->
5. WHEN a camada 1 termina THEN o sistema SHALL pedir ao revisor LLM que classifique cada frase como suportada ou não e que dê as linhas de evidência das suportadas.  <!-- FID-05 -->
6. The system SHALL enviar ao revisor só o código do nó, os nomes dos vizinhos e o rascunho.  <!-- FID-06 -->
7. IF uma frase suportada pelo revisor aponta uma linha de evidência fora do intervalo do nó, ou não aponta nenhuma THEN o sistema SHALL tratar a frase como "não suportada".  <!-- FID-07 -->
8. WHEN alguma frase é marcada como "não suportada" THEN o sistema SHALL pedir um novo rascunho com a lista de problemas, no máximo 2 vezes.  <!-- FID-08 -->
9. IF ainda restam frases não suportadas depois de 2 novos rascunhos THEN o sistema SHALL removê-las do que exibe e grava, e SHALL mostrar o selo "Revisado com cortes".  <!-- FID-09 -->
10. IF nenhuma frase do resumo sobrevive à revisão THEN o sistema SHALL mostrar "Não foi possível gerar um resumo fiel." com o botão "Tentar de novo", e não SHALL gravar no cache.  <!-- FID-10 -->
11. WHEN todas as frases passam na revisão THEN o sistema SHALL mostrar o selo "Revisado".  <!-- FID-11 -->

*Evidência e cobertura*

12. WHEN o resumo é exibido THEN o sistema SHALL mostrar ao lado de cada frase as suas linhas de evidência (ex.: "L5" ou "L5–7").  <!-- FID-12 -->
13. WHEN o usuário clica nas linhas de evidência de uma frase THEN o sistema SHALL destacar essas linhas no código do nó.  <!-- FID-13 -->
14. WHEN o detalhe de um nó é exibido THEN o sistema SHALL listar, abaixo do resumo e sem usar o LLM, cada efeito externo do nó (passos HTTP, BANCO, ARQUIVO, E-MAIL e EXTERNO), com a chamada e a linha, tirados do grafo.  <!-- FID-14 -->
15. The system SHALL usar o modelo de `APP8N8_REVIEW_MODEL` no revisor e, sem a variável, o mesmo modelo do resumo.  <!-- FID-15 -->

**Independent Test**: Com um LLM falso cujo rascunho diz "pesa 5 kg" para um código sem "5" nem "kg", a frase deve ser cortada e aparecer o selo "Revisado com cortes". Com um rascunho fiel, deve aparecer "Revisado", e cada frase deve mostrar linhas que, ao clicar, ficam destacadas no código. Em `calcular_frete`, a lista de efeitos externos deve mostrar `requests.get` (HTTP) com a linha certa, sem nenhuma chamada ao LLM.

---

### P2: Cache que detecta mudanças

**User Story**: Como desenvolvedor, quero que o resumo seja atualizado quando o código ou os vizinhos do nó mudam, e que o sistema diga o que mudou, para nunca ler um resumo velho.

**Why P2**: Sem isso o resumo fica errado em silêncio. Depende da P1, porque só o resultado revisado vai para o cache.

**Acceptance Criteria**:

1. The system SHALL guardar com cada explicação uma impressão digital com componentes separados: código normalizado do nó, vizinhos, modelo do resumo, modelo do revisor, versão do prompt e versão do revisor.  <!-- CACHE-01 -->
2. WHEN um nó é aberto e todos os componentes são iguais aos guardados THEN o sistema SHALL usar o cache e não SHALL chamar o LLM.  <!-- CACHE-02 -->
3. WHEN um nó é aberto e algum componente é diferente THEN o sistema SHALL gerar e revisar uma nova explicação e substituir a entrada desse nó.  <!-- CACHE-03 -->
4. WHEN uma explicação é substituída pelo CACHE-03 THEN o sistema SHALL mostrar "Resumo atualizado: <motivo>", com o motivo sendo "o código mudou", "os vizinhos mudaram" ou "o modelo ou o prompt mudou" (vários motivos, separados por vírgula).  <!-- CACHE-04 -->
5. WHEN o código do nó é igual mas está em outra posição do trecho THEN o sistema SHALL usar o cache e mostrar as linhas de evidência e de sugestão ajustadas à nova posição.  <!-- CACHE-05 -->
6. The system SHALL manter no máximo uma entrada de cache por identidade de nó.  <!-- CACHE-06 -->
7. IF a entrada de cache do nó não pode ser lida ou está num formato de versão antiga THEN o sistema SHALL tratá-la como ausente e gravar uma nova no lugar dela. Os arquivos da feature 01, que ficam em outro caminho, nunca são lidos. Eles contam como ausentes e ficam no disco até a limpeza adiada.  <!-- CACHE-07 -->

**Independent Test**: Abrir `calcular_frete` e gravar no cache. Renomear `processar_pedido` para `processar` e reabrir: deve aparecer "Resumo atualizado: os vizinhos mudaram". Inserir 3 linhas em branco antes de `calcular_frete` e reabrir: deve vir do cache, com as linhas de evidência 3 a mais.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| FID-01..11 | P1: Revisão | Execute | Verified |
| FID-12..15 | P1: Evidência e cobertura | Execute | Verified |
| CACHE-01..07 | P2: Cache | Execute | Verified |

**Coverage:** 22 total, 22 mapped to tasks, 22 verified (validation.md, iteração 2).

---

## Success Criteria

- [ ] Em testes com rascunhos falsos que inventam números, unidades e identificadores, 100% das frases inventadas são cortadas.
- [ ] Toda frase exibida tem linhas de evidência dentro do nó.
- [ ] A suíte Playwright cobre os Independent Tests das duas histórias e passa.
- [ ] Renomear um vizinho atualiza o resumo. Mover o nó não gera nova chamada.
