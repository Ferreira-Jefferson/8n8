# Configurações e LLM sob demanda Specification

## Problem Statement

Hoje o painel pede o resumo sozinho quando a pessoa seleciona um nó, e uma única chamada devolve resumo, entradas, saídas e sugestões. Cada chamada gasta a chave ou a assinatura da pessoa, mesmo quando ela só queria navegar pelo mapa. A config do LLM só entra por variáveis de ambiente, e quem instala a CLI não tem um `.env`. A AD-023 decide: o resumo e as sugestões viram dois pedidos separados, que por padrão só rodam com um clique, e um painel de configurações na tela guarda provedor, chave, URL, modelo e o modo automático de cada pedido.

Depende de: 07-cli.

## Done When

Com a CLI instalada e sem nenhuma variável de ambiente, o usuário abre o mapa, abre o painel de configurações, cola a chave do OpenRouter e salva. Ao selecionar um nó, o painel mostra os botões "Gerar resumo" e "Pedir sugestões", e nada é gasto até o clique. Depois de um clique, o mesmo nó mostra o resumo do cache sem clique.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Provedor Claude Code | Feature 09. |
| Guardar a chave no `SecretStorage` do VS Code | Feature 10. O núcleo recebe o armazenamento da config por parâmetro, e a extensão traz o dela. |
| Listar os modelos do provedor numa caixa de seleção | Pede uma chamada à API do provedor e um formato por provedor. O campo de modelo é texto livre, com o modelo padrão do provedor como dica. |
| Modelo do revisor no painel | Continua só em `APP8N8_REVIEW_MODEL`. Sem ela, o revisor usa o modelo do resumo (FID-15). |
| Cifrar a chave em `config.json` | O Node não acessa o cofre do sistema sem módulo nativo, e a 07 proíbe scripts de instalação (AD-023). O arquivo fica só com permissão do dono. |
| Desligar os títulos automáticos | Os títulos continuam automáticos quando há LLM (AD-017, AD-023). |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Modo padrão do resumo e das sugestões | Por clique (os dois desligados) | Nada é gasto sem pedido (AD-023). | y |
| Rotas | `POST /api/summary` e `POST /api/suggestions` no lugar de `POST /api/explain`, as duas com o mesmo corpo | Cada pedido tem resposta e cache próprios. Duas rotas deixam o contrato de cada uma explícito. | y |
| Docstring | Vai só no pedido de sugestões, que julga se ela reflete o código. O resumo nunca recebe a docstring | O resumo já é proibido de usar a docstring (CORE-16). A sugestão "Atualize a docstring" é uma sugestão. | y |
| Variáveis que ganham do painel | As da AD-021 (`APP8N8_LLM_PROVIDER`, chave e URL do provedor, `APP8N8_MODEL`) e duas novas: `APP8N8_AUTO_SUMMARY` e `APP8N8_AUTO_SUGGESTIONS` (`1`/`true` ou `0`/`false`) | "Uma variável de ambiente ganha do painel" (AD-023). As duas novas deixam os testes E2E antigos rodarem no modo automático sem tocar na config do usuário. | y |
| Pasta do `config.json` na CLI | `~/.8n8/config.json`, trocada por `APP8N8_CONFIG_DIR` | Mesmo lugar dos outros dados (DIST-09). A variável isola os testes E2E. | y |
| Chave de um provedor em outro | A chave, a URL e o modelo guardados valem só para o provedor guardado. Se o ambiente escolhe outro provedor, eles não valem | Uma chave nunca vai para o servidor de outro provedor. | y |
| Valor inválido no `config.json` | O arquivo ilegível ou fora do formato conta como vazio. O próximo salvamento o substitui | Mesma regra do cache (CACHE-07). O mapa nunca deixa de abrir por causa da config. | y |

**Open questions:** none.

---

## User Stories

### P1: Resumo e sugestões só quando a pessoa pede ⭐ MVP

**User Story**: Como usuário, quero que o resumo e as sugestões de um nó só gastem a minha chave quando eu pedir, e que o que já foi gerado apareça sem novo gasto.

**Why P1**: Hoje cada nó selecionado gasta de 2 a 6 chamadas (AD-008), mesmo quando a pessoa só navega.

**Acceptance Criteria**:

1. WHEN o cliente envia `POST /api/summary` com `{root, nodeId}` ou `{source, nodeId}` THEN o sistema SHALL devolver só o resumo, as entradas e as saídas do nó, revisados nas duas camadas da AD-008, com o mesmo formato de status de hoje (`ok`, `unfaithful`, `no-key`, `error`).  <!-- CFG-01 -->
2. WHEN o cliente envia `POST /api/suggestions` com o mesmo corpo THEN o sistema SHALL devolver só as sugestões do nó, revisadas nas duas camadas, com no máximo 5 itens. Uma lista vazia depois da revisão SHALL ser uma resposta `ok`, nunca `unfaithful`.  <!-- CFG-02 -->
3. The prompt do resumo SHALL pedir só `summary`, `inputs` e `outputs`, e a mensagem do resumo SHALL ir sem o bloco da docstring. O prompt das sugestões SHALL pedir `suggestions` e, quando o nó tem docstring, o veredito `docstring`. Uma docstring que não reflete o código SHALL virar a primeira sugestão, como hoje.  <!-- CFG-03 -->
4. The sistema SHALL guardar o resumo em `<cache>/nodes/` e as sugestões em `<cache>/suggestions/`, cada um com a própria impressão digital (AD-009). A impressão digital do resumo SHALL deixar a docstring de fora, porque o prompt do resumo não a recebe (L-004). Uma entrada de versão antiga SHALL contar como ausente.  <!-- CFG-04 -->
5. WHEN o corpo traz `cachedOnly: true` THEN o sistema SHALL devolver a entrada do cache quando a impressão digital confere, ou `{status: "not-cached"}`, sem chamar o LLM.  <!-- CFG-05 -->
6. WHEN a pessoa seleciona um nó e o modo automático de um pedido está desligado THEN o painel SHALL pedir esse pedido com `cachedOnly: true`. Um acerto de cache SHALL aparecer sem clique. Sem acerto, o painel SHALL mostrar o botão "Gerar resumo" (resumo) ou "Pedir sugestões" (sugestões).  <!-- CFG-06 -->
7. WHEN a pessoa clica em "Gerar resumo" ou "Pedir sugestões" THEN o painel SHALL fazer o pedido sem `cachedOnly`, mostrar "Gerando resumo…" ou "Pedindo sugestões…" e depois o resultado.  <!-- CFG-07 -->
8. WHEN o modo automático de um pedido está ligado THEN o painel SHALL fazer esse pedido sem `cachedOnly` assim que a pessoa seleciona o nó.  <!-- CFG-08 -->
9. IF nenhum provedor de LLM está configurado THEN o painel SHALL mostrar "Configure um provedor de LLM em Configurações." no lugar do resumo, com um botão que abre o painel de configurações. As sugestões SHALL mostrar o mesmo texto.  <!-- CFG-09 -->
10. WHEN as sugestões de um nó chegam THEN os cartões de sugestão do mapa e a contagem no nó (VID-31, VID-32) SHALL usar essas sugestões. Um resumo nunca SHALL criar cartão.  <!-- CFG-10 -->
11. WHEN as sugestões chegam vazias THEN o painel SHALL mostrar "Nenhuma sugestão para este nó.".  <!-- CFG-11 -->

**Independent Test**: com o modo padrão e o LLM falso do E2E, selecionar um nó não faz nenhuma chamada ao LLM. Clicar em "Gerar resumo" faz o rascunho e a revisão do resumo, e só deles. Selecionar o nó de novo mostra o resumo do cache, sem chamada.

---

### P1: Painel de configurações

**User Story**: Como usuário da CLI, quero colar a minha chave, escolher o provedor e o modelo e ligar o modo automático pela tela, sem criar variáveis de ambiente.

**Why P1**: Quem instala a CLI não tem `.env`. Sem o painel, o LLM só funciona para quem sabe criar variáveis de ambiente.

**Acceptance Criteria**:

1. WHEN o cliente pede `GET /api/settings` THEN o sistema SHALL devolver o provedor, a URL, o modelo e os dois modos automáticos efetivos, a lista de provedores (id e modelo padrão), `hasKey` (se há chave efetiva) e, para cada campo, o nome da variável de ambiente que o define, quando há uma. A resposta nunca SHALL conter a chave.  <!-- CFG-12 -->
2. WHEN o cliente envia `PUT /api/settings` com um ou mais campos (`provider`, `apiKey`, `baseURL`, `model`, `autoSummary`, `autoSuggestions`) THEN o sistema SHALL gravar esses campos no armazenamento de config e devolver o mesmo corpo do `GET`. `apiKey: null`, `baseURL: null` e `model: null` SHALL apagar o valor guardado.  <!-- CFG-13 -->
3. IF o corpo do `PUT` tem um campo desconhecido, um provedor que não existe, uma `baseURL` que não começa com `http://` ou `https://`, ou uma chave vazia THEN o sistema SHALL responder 400 e não gravar nada.  <!-- CFG-14 -->
4. WHEN um `PUT` muda o provedor ou a URL THEN o sistema SHALL apagar a chave guardada, a não ser que o mesmo `PUT` traga uma chave nova. Uma troca de provedor SHALL também apagar a URL e o modelo guardados que o mesmo `PUT` não traz, porque eles eram do provedor anterior.  <!-- CFG-15 -->
5. The config efetiva SHALL vir campo a campo: a variável de ambiente ganha do valor guardado, e o valor guardado ganha do padrão. A chave, a URL e o modelo guardados SHALL valer só quando o provedor guardado é o provedor efetivo.  <!-- CFG-16 -->
6. WHEN um `PUT` grava a config THEN o próximo pedido de resumo, sugestões ou títulos SHALL usar a config nova, sem reiniciar o servidor.  <!-- CFG-17 -->
7. The núcleo SHALL receber o armazenamento da config por parâmetro (`settings` em `CoreOptions`), com `read` e `write`. O núcleo continua sem ler o ambiente do processo nem arquivos por conta própria (DIST-13).  <!-- CFG-18 -->
8. The CLI SHALL guardar a config em `<APP8N8_CONFIG_DIR ou ~/.8n8>/config.json`, com escrita atômica (arquivo temporário e `rename`) e permissão só do dono (`0o600`). Um arquivo ausente, ilegível ou fora do formato SHALL contar como config vazia.  <!-- CFG-19 -->
9. WHEN a pessoa clica no botão "Configurações" (presente na tela inicial, no editor e no mapa) THEN a tela SHALL abrir um diálogo com: provedor (lista), chave (campo de senha, vazio, com "Chave guardada" quando `hasKey`), botão "Apagar chave", URL e modelo (com o padrão do provedor como dica), e as caixas "Gerar o resumo ao selecionar um nó" e "Pedir as sugestões ao selecionar um nó".  <!-- CFG-20 -->
10. WHEN a pessoa salva o diálogo THEN a tela SHALL enviar só os campos que mudaram, mostrar "Configurações salvas." e passar a usar os modos automáticos novos. IF o servidor responde 400 THEN o diálogo SHALL mostrar "Não foi possível salvar. Confira a URL e a chave." e manter os valores digitados.  <!-- CFG-21 -->
11. WHILE uma variável de ambiente define um campo THEN o diálogo SHALL mostrar esse campo desativado, com "Definido pela variável <NOME>".  <!-- CFG-22 -->

**Independent Test**: no E2E, a CLI instalada sobe sem variáveis de LLM, o teste salva uma chave falsa e a URL do LLM falso pelo diálogo, e o "Gerar resumo" passa a funcionar sem reiniciar.

---

### P1 (segurança): A chave só entra

**User Story**: Como usuário, quero que a chave que colei na tela nunca volte por nenhuma rota e nunca vá para um servidor que não escolhi.

**Why P1**: A chave passa a viver num arquivo e a entrar pela API local. Uma rota que a devolva, ou uma troca de URL que a leve junto, entrega a chave a terceiros.

**Acceptance Criteria**:

1. The suíte de segurança SHALL gravar uma chave sentinela pelo `PUT /api/settings` e falhar se ela aparece, inteira ou pelo começo, no corpo ou nos cabeçalhos de qualquer resposta de qualquer rota, inclusive numa mensagem de erro do provedor.  <!-- CFG-23 -->
2. The suíte de segurança SHALL atacar `GET` e `PUT /api/settings` como ataca as outras rotas (DIST-21) e provar com um dublê que um ataque nunca grava a config.  <!-- CFG-24 -->
3. The teste da CLI SHALL provar que o `config.json` fica com permissão `0o600` onde o sistema a aplica (Linux e macOS), e que a saída do terminal nunca mostra a chave guardada.  <!-- CFG-25 -->

**Independent Test**: `pnpm test` roda a suíte de segurança e passa. Fazer o `GET /api/settings` devolver a chave, ou trocar a URL sem apagar a chave, faz um teste falhar.

---

## Requirement Traceability

| Requirement ID | Story | Status |
| -------------- | ----- | ------ |
| CFG-01..11 | P1: Resumo e sugestões só quando a pessoa pede | Pending |
| CFG-12..22 | P1: Painel de configurações | Pending |
| CFG-23..25 | P1 (segurança): A chave só entra | Pending |
