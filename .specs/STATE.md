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

## Handoff

- **Features (em sequência):** 01-fatia-central (24 ACs), 02-pasta-local (9 ACs), 03-modo-grafo (7 ACs). Substituem a spec única `mapa-de-codigo` (54 ACs), que foi dividida por excesso de escopo.
- **01-fatia-central:** concluída e verificada. Verifier PASS na iteração 2 (24/24 ACs, 209 testes, sensor 7/7 mortos). Relatório em `validation.md`.
- **Pendências abertas (não bloqueiam):**
  - fechar as lacunas SP-1..SP-5 na spec;
  - incluir os vizinhos na chave do cache;
  - fidelidade do resumo: "kg" foi inventado e `requests.get` ficou de fora;
  - o pnpm 12.6.0 global está quebrado no Windows para chamadas aninhadas. Os workers usaram um shim no scratchpad.
- **Next:** Design da 02-pasta-local (spec já aprovada).
