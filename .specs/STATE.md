# STATE

## Decisions

### AD-001 — Estrutura por código, explicação por LLM
- **Date:** 2026-10-13
- **Context:** O mapa precisa ser confiável e reproduzível.
- **Decision:** A estrutura (nós, fios, hierarquia) vem só de parsing determinístico. O LLM só escreve resumos e sugestões e nunca cria nem remove nós ou fios.
- **Consequence:** A mesma entrada gera o mesmo grafo. O app funciona sem chave de LLM, só sem textos.
- **Status:** substituída pela AD-017.

### AD-002 — OpenRouter como gateway de LLM
- **Date:** 2026-10-13
- **Context:** O projeto roadmap já usa o OpenRouter com uma chave ativa.
- **Decision:** Todas as chamadas de LLM passam pelo OpenRouter via API compatível com OpenAI (`openai` SDK, `baseURL: https://openrouter.ai/api/v1`). A chave fica em `OPENROUTER_API_KEY`. O modelo padrão é `~deepseek/deepseek-v4-flash-latest`, o mesmo tier "medium" do roadmap: bom e barato. A variável `CODE2N8N_MODEL` troca o modelo.
- **Consequence:** Um único cliente de LLM, isolado no módulo de explicação.

### AD-003 — Modularização por responsabilidade
- **Date:** 2026-10-13
- **Context:** Pedido do usuário: o sistema deve ser totalmente modular por responsabilidade.
- **Decision:** Cada responsabilidade é um pacote com fronteira explícita: entrada, extração, modelo de grafo, explicação, servidor e interface. Um pacote só depende de pacotes de nível inferior e nunca importa a parte interna de outro.
- **Consequence:** Trocar a linguagem de entrada ou o provedor de LLM afeta um único pacote.

### AD-004 — Stack
- **Date:** 2026-10-13
- **Decision:** TypeScript, monorepo pnpm, Biome e Vitest, igual ao roadmap. Parser: Tree-sitter (`web-tree-sitter` com a gramática Python). Interface: React com React Flow (modo fluxo) e um grafo de forças (modo grafo). App web local.
- **Consequence:** A design phase confirma as versões exatas das bibliotecas.

### AD-005 — Fronteiras de pacote garantidas no build
- **Date:** 2026-10-13
- **Context:** A AD-003 exige fronteiras explícitas. Uma convenção sem checagem se perde.
- **Decision:** Cada pacote exporta só `"."` (o `index.ts`). O pnpm estrito impede o uso de dependências não declaradas. O `dependency-cruiser` roda em `pnpm check` e bloqueia ciclos, setas fora da ordem `model` ← `extract-*`/`explain` ← `server`, o import de `explain`, `extract-*` ou `server` pela web e o uso de `node:*` em `model` e na web. Sem project references do TypeScript.
- **Consequence:** Um import que cruza uma fronteira falha no `check`. Um pacote novo (por exemplo, `input` na feature 02) declara as próprias setas no `.dependency-cruiser.cjs`.

### AD-006 — Contrato do grafo e IDs estruturais
- **Date:** 2026-10-13
- **Context:** A AD-001 pede o mesmo grafo para a mesma entrada. As features 02 e 03 reutilizam o grafo.
- **Decision:** O pacote `model` define `Graph`, `FlowNode`, `FlowEdge` e a interface `Extractor`. Os IDs saem do caminho na estrutura (`fn:nome`, `cls:Nome/fn:metodo`, `<pai>/s<i>`, `<cond>/b<j>/s<i>`, `#n` para nomes repetidos). As linhas são 1-based e inclusivas. Os nós ficam em pré-ordem, na ordem do código.
- **Consequence:** Outras linguagens implementam `Extractor` e produzem o mesmo formato. A feature 02 acrescenta o arquivo ao prefixo do ID.

### AD-007 — Servidor dono do parsing e do LLM
- **Date:** 2026-10-13
- **Context:** O parser e a chave do LLM poderiam rodar no navegador ou no servidor.
- **Decision:** O servidor local (Hono em `127.0.0.1`) extrai o grafo e monta todo pedido ao LLM a partir do próprio grafo. A web é um cliente fino por HTTP e nunca recebe a chave. O servidor recusa um cabeçalho `Host` que não seja local.
- **Consequence:** O parser roda em um só runtime (Node). A feature 02 lê pastas no mesmo processo.

### AD-008 — Todo texto do LLM passa por revisão em duas camadas e carrega evidência
- **Date:** 2026-10-13
- **Context:** Feature 04. O resumo inventou "kg". Um texto do LLM sem verificação destrói a confiança.
- **Decision:** O pacote `explain` só devolve ou grava texto do LLM depois de duas camadas: (1) regras determinísticas puras sobre o código do nó e os nomes dos vizinhos; (2) um revisor LLM com contrato JSON validado por zod que julga cada item e dá as linhas de evidência. Cada item exibido (`Claim`) tem `id`, `text` e `lines`. O revisor usa o mesmo gateway (AD-002), e `CODE2N8N_REVIEW_MODEL` escolhe o modelo, com `CODE2N8N_MODEL` como padrão.
- **Consequence:** Uma abertura sem cache custa de 2 a 6 chamadas. Todo texto novo gerado por LLM (por exemplo, em features futuras) segue o mesmo contrato `Claim`.

### AD-009 — Cache de explicação por identidade de nó, com impressão digital por componentes
- **Date:** 2026-10-13
- **Context:** Feature 04. A chave da feature 01 (`sha256([code, model, prompt])`) ignorava os vizinhos (L-004) e não dizia o que mudou.
- **Decision:** Há uma entrada por ID estrutural (AD-006) em `.cache/explain/nodes/<sha256(nodeId)>.json`, com `schemaVersion`. A entrada guarda uma impressão digital com componentes separados: código normalizado, vizinhos ordenados, modelo do resumo, modelo do revisor, versão do prompt e versão do revisor. Toda entrada enviada ao LLM está na impressão digital. As linhas ficam relativas ao nó. Uma entrada ilegível ou de outra versão conta como ausente e é sobrescrita.
- **Consequence:** O sistema sabe por que uma explicação foi trocada. Uma mudança de formato só exige subir `schemaVersion`. As entradas da feature 01 ficam órfãs.

### AD-010 — Informação derivada do grafo sem LLM é calculada na web
- **Date:** 2026-10-13
- **Context:** Feature 04 (FID-14, efeitos externos). A web já recebe o `Graph` inteiro e importa só tipos de `model`.
- **Decision:** Uma visão deterministicamente derivada do `Graph`, como os efeitos externos de um nó, é uma função pura em `apps/web` sobre o `Graph` já carregado. Ela não entra na resposta de `/api/explain` e não cria outra rota.
- **Consequence:** Essas listas aparecem sem chave de LLM e com o explain falhando. A web continua importando só tipos de `model`.

### AD-011 — Decoradores no contrato do grafo
- **Date:** 2026-10-13
- **Context:** A feature 03 (GRAPH-05) precisa saber se uma função tem decorador, para tratá-la como ponto de entrada. Na feature 02 a web não tem o fonte de cada arquivo.
- **Decision:** `FlowNode` ganha o campo `decorators?: string[]`, com o texto de cada decorador sem `@` e sem argumentos (ex.: `"app.route"`). O extrator preenche o campo em funções, métodos e classes decorados.
- **Consequence:** O campo é aditivo e opcional, e outro `Extractor` preenche o mesmo campo. A web detecta pontos de entrada sem ler o texto do código.

### AD-012 — Modo grafo: layout determinístico com d3-force, desenho com React Flow
- **Date:** 2026-10-13
- **Context:** Feature 03. Os testes E2E precisam de posições estáveis e de seletores no DOM.
- **Decision:** O layout de forças é uma função pura em `apps/web` (`d3-force` 3.0.0, `.stop().tick(300)`, posições inteiras). O desenho usa o React Flow, que já está instalado. O modo (`flow`/`graph`) fica no `navReducer`, e trocar de modo nunca muda `nav.selected`.
- **Consequence:** A mesma entrada gera o mesmo grafo, e os seletores do E2E servem para os dois modos. A escala para milhares de nós fica adiada.

### AD-013 — IDs de projeto
- **Date:** 2026-10-13
- **Context:** Feature 02. A AD-006 previa um prefixo de arquivo nos IDs.
- **Decision:**
  - Formatos de ID:
    - pastas: `dir:<rel>`;
    - arquivos da raiz: ficam sob `dir:.`, rotulado "raiz";
    - arquivos: `file:<rel>`;
    - nós internos: `childId(fileId, <id do trecho>)`.
  - `<rel>` é o caminho POSIX relativo à raiz.
  - As entradas são ordenadas por unidade de código, nunca por `localeCompare`.
  - Os IDs de trecho não mudam. `Graph.project` marca um grafo de projeto.
- **Consequence:** IDs determinísticos entre execuções e sistemas operacionais. Refina a AD-006.

### AD-014 — Pacote `input`
- **Date:** 2026-10-13
- **Decision:** O pacote `input` só lê o disco (API somente leitura, sem seguir links simbólicos) e só depende de `model`. Um `extract-*` recebe `SourceFile[]` e nunca toca no disco. A resolução de módulos é da linguagem. O `server` compõe `input` com `extract-*`.
- **Consequence:** Trocar a fonte (por exemplo, um repositório remoto) afeta só o `input`.

### AD-015 — Explicação de nó de projeto
- **Date:** 2026-10-13
- **Decision:**
  - O cliente envia `{root,nodeId}`.
  - A cada pedido, o servidor relê e reextrai a pasta, e nunca usa código vindo do cliente.
  - A identidade no cache é `<raiz real POSIX>|<nodeId>`.
  - Um vizinho de outro arquivo vai como `<caminho>:<rótulo>`.
- **Consequence:** O servidor não guarda estado e nunca explica código velho. Uma sessão no servidor fica como plano B se reler a pasta ficar lento.

### AD-016 — API local só aceita JSON
- **Date:** 2026-10-13
- **Context:** Um POST "simples" de outra página escapa da preflight do CORS, e a guarda de `Host` não cobre esse caso.
- **Decision:** A API local recusa com 415 qualquer `content-type` diferente de `application/json`.
- **Consequence:** Outras páginas não conseguem disparar a API sem preflight.

### AD-017 — Títulos de nó pelo LLM, com nome provisório
- **Date:** 2026-10-13
- **Context:** Feature 05. O mapa do vídeo mostra títulos em PTS em todos os nós. O usuário confirmou que o LLM escreve esses títulos.
- **Decision:** A estrutura (nós, fios, hierarquia) vem só de parsing determinístico. O LLM escreve resumos, sugestões e títulos de nó, e nunca cria nem remove nós ou fios. Um título passa pela revisão em duas camadas (AD-008), tem no máximo 6 palavras e fica no cache por nó (AD-009). Sem título revisado, a web mostra um nome provisório determinístico.
- **Consequence:** O mapa continua completo sem chave de LLM. Substitui a AD-001.

### AD-018 — Tema visual do vídeo
- **Date:** 2026-10-13
- **Context:** Feature 05. O usuário aprovou o vídeo como a régua de aparência.
- **Decision:** As cores, medidas e fontes do vídeo são tokens CSS em `apps/web/src/styles.css` (fundo `#121110`, destaque `#D4FF3F`, texto `#F5F2EC`, secundário `#A8A399`). As fontes Archivo Black, Space Grotesk e DM Mono vêm de pacotes `@fontsource` empacotados no build, sem pedido a outro host.
- **Consequence:** Uma tela nova usa os mesmos tokens. Uma mudança de aparência é aprovada por imagens de referência do Playwright.

## Handoff

*Pausado pelo usuário em 2026-10-14, durante a verificação da feature 05. Nada foi enviado ao remoto.*

- **Ordem das features:** 01-fatia-central ✅ → 04-fidelidade-e-cache ✅ → 02-pasta-local ✅ → 05-mapa-do-video (implementada, falta verificar).
- **Features futuras (decisão do usuário em 2026-10-13):** 03-modo-grafo e o tour em vídeo (degrau 4). A spec, o design e as tasks da 03 ficam guardados, mas não serão implementados agora.
- **01, 04 e 02:** verificadas (PASS). Detalhes no `validation.md` de cada uma.
- **05-mapa-do-video:**
  - T1–T48 feitas e mescladas no master (merge e7ed837). T49–T50 (imagens de referência) canceladas pelo usuário em 2026-10-14. O usuário também cancelou a página de comparação com o vídeo.
  - Gate no master em e7ed837: typecheck, check, 830 unitários e 83 E2E verdes. O E2E passou 3 vezes seguidas na feat/05d. O projeto `performance` (`CODE2N8N_PERF=1 pnpm exec playwright test --project performance`) passa 9/9.
  - Medidas de desempenho: o mapa aparece em cerca de 45 ms, a animação termina em cerca de 3 s, abrir um nó leva cerca de 1,2 s (0,13 s sem animação), Voltar leva cerca de 20–80 ms e uma pasta de 300 arquivos leva cerca de 0,2 s.
  - O bug do canvas em branco foi corrigido em 089e3a6. O "em branco" que restou na porta 4319 era erro de medição do teste de desempenho, corrigido em f75feb6, com teste de guarda em 632b943.
  - **Próximo passo:** rodar de novo o Verifier independente (validate.md, sensor de mutantes num worktree temporário), escrever o `validation.md` e rodar `validate_state.py`. A primeira tentativa foi interrompida pela pausa, sem resultado. O worktree temporário dela foi apagado.
- **Desvio registrado:** os commits 7efa6d5 (T11) e 7743bc4 (T13) da 04 e bf90eb8 (T36) da 05 entraram com testes vermelhos. O histórico não foi reescrito.
- **Ambiente:**
  - O pnpm 12.6.0 global foi reinstalado em 2026-10-13 com os scripts de instalação ligados e agora roda o binário nativo (`pnpm.exe`). Se ele voltar a dizer "pnpm is running through Node.js", reinstale com `npm install -g pnpm@12.6.0 --foreground-scripts`.
  - O Playwright precisa de `C:\Windows\System32` no PATH para chamar o `taskkill`.
- **Pendências não bloqueantes:**
  - Os worktrees `../code2n8n-f02`, `../code2n8n-05a`, `05b`, `05c` e `05d` e seus branches continuam existindo. Não apagar sem pedido.
  - Preencher a seção "Comandos" do CLAUDE.md.
  - Lições candidatas L-015..L-017 esperam confirmação de outra feature.
