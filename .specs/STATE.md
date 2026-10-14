# STATE

## Decisions

### AD-001 — Estrutura por código, explicação por LLM
- **Date:** 2026-10-13
- **Context:** O mapa precisa ser confiável e reproduzível.
- **Decision:** A estrutura (nós, fios, hierarquia) vem só de parsing determinístico. O LLM só escreve resumos e sugestões e nunca cria nem remove nós ou fios.
- **Consequence:** A mesma entrada gera o mesmo grafo. O app funciona sem chave de LLM, só sem textos.

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

## Handoff

*Rodada concluída em 2026-10-13. Nada foi enviado ao remoto.*

- **Ordem das features:** 01-fatia-central ✅ → 04-fidelidade-e-cache ✅ → 02-pasta-local ✅.
- **Features futuras (decisão do usuário em 2026-10-13):** 03-modo-grafo e o tour em vídeo (degrau 4). A spec, o design e as tasks da 03 ficam guardados, mas não serão implementados agora.
- **01-fatia-central:** verificada (PASS, 24/24). E2E em `e2e/fatia-central.e2e.ts` (14 testes).
- **04-fidelidade-e-cache:** verificada (PASS na iteração 2, commit 7895637). E2E em `e2e/fidelidade.e2e.ts` e `e2e/cache.e2e.ts`.
- **02-pasta-local:** verificada (PASS na iteração 3, commit 1d691f8). Feita num worktree e mesclada sem conflito. As iterações 1 e 2 falharam só por lacunas de teste, sem bug de produção. E2E em `e2e/pasta-local.e2e.ts` (9).
- **Gate atual:** `pnpm typecheck && pnpm check && pnpm test && pnpm e2e` verde. Unitários 477, E2E 40. Os últimos a ganhar E2E: FID-04, FID-07, CORE-22, CORE-17, FID-05, FID-06, CORE-21, CACHE-07 e CACHE-01. O teste do CORE-21 usa um quarto servidor (porta 4320) sem modelo configurado. Teste manual com a chave real em 2026-10-13: resumos fiéis; o modelo deixa passar sugestões óbvias.
- **Próximo passo:** nenhum agendado. O usuário escolhe a próxima feature.
- **Desvio registrado:** os commits 7efa6d5 (T11) e 7743bc4 (T13) da 04 entraram com testes vermelhos. O histórico não foi reescrito.
- **Ambiente:**
  - O pnpm 12.6.0 global foi reinstalado em 2026-10-13 com os scripts de instalação ligados e agora roda o binário nativo (`pnpm.exe`). Se ele voltar a dizer "pnpm is running through Node.js", reinstale com `npm install -g pnpm@12.6.0 --foreground-scripts`.
  - O Playwright precisa de `C:\Windows\System32` no PATH para chamar o `taskkill`.
- **Pendências não bloqueantes:**
  - O worktree `../code2n8n-f02` e o branch `feat/02-pasta-local` continuam existindo. Não apagar sem pedido.
  - Preencher a seção "Comandos" do CLAUDE.md.
  - Lições candidatas L-015..L-017 esperam confirmação de outra feature.
