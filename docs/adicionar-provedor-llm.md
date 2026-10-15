# Adicionar um provedor de LLM

O pacote `packages/llm` guarda tudo o que depende de provedor ou de modelo. O pipeline `explain` não conhece nenhum dos dois. Ele só chama `LlmClient.complete`.

Este guia mostra como acrescentar um provedor novo.

## O contrato

O contrato do cliente fica no pacote `model`:

```ts
interface LlmClient {
  complete(req: {
    model: string;
    messages: ChatMessage[];
    json: "native" | "prompt";
  }): Promise<string>;
}
```

O cliente faz uma chamada e retorna o texto da resposta. O cliente não tenta de novo. Se a chamada falha, o cliente lança o erro.

O campo `json` é o pedido do pipeline. O valor `native` quer dizer: "responda em JSON". O cliente decide, pelo perfil do modelo, se envia `response_format` ou se confia só no prompt.

Cada provedor implementa `LlmProvider`, em `packages/llm/src/provider.ts`:

| Campo | O que faz |
|---|---|
| `id` | O nome do provedor. É o valor de `APP8N8_LLM_PROVIDER`. Entra na impressão digital do cache. |
| `defaultModel` | O modelo usado quando `APP8N8_MODEL` está vazia. |
| `usesKey` | `false` para um provedor sem chave (como o `claude-code`). O diálogo de Configurações esconde o campo da chave. |
| `env` | Os nomes das variáveis de chave (`apiKey`) e de URL (`baseURL`), quando o provedor tem. A URL só vem da variável: a tela não tem campo de URL. |
| `isConfigured(config, options)` | Retorna `false` se falta o que o provedor precisa. Então o painel mostra "configure um provedor". `options.env` é o ambiente do host. |
| `create(config, options)` | Retorna o `LlmClient`. `options.fetch` serve aos testes, e `options.env` traz o ambiente do host. |

Um provedor que roda um programa (como `claude-code.ts`) é exceção da regra `no-child-process`. Ele entra nomeado na regra, no teste das guardas (`apps/cli/src/__tests__/guards.test.ts`) e no `CODEOWNERS`, e roda sem shell, numa pasta vazia, com o código pelo stdin.

## O perfil de modelo

O perfil fica em `packages/llm/src/profiles.ts`. Ele diz o que um modelo precisa:

- `json`: `native` envia `response_format`. `prompt` não envia.
- `reasoning`: `off` pede ao provedor que pule o raciocínio.
- `routing`: a ordem dos provedores finais a tentar primeiro (só o OpenRouter usa).

Cada entrada de `MODEL_PROFILES` tem uma expressão `match` e um `profile`. A primeira entrada que casa com o id do modelo vale. Se nenhuma casa, vale `DEFAULT_PROFILE`.

Para um modelo novo com uma exigência própria, acrescente uma entrada:

```ts
{ match: /^meu-modelo\//, profile: { ...DEFAULT_PROFILE, json: "prompt" } }
```

O provedor lê o perfil. O pipeline nunca lê.

## Exemplo: um provedor novo

Este exemplo cria o provedor `meu-provedor`. A API dele fala o protocolo da OpenAI, mas exige um cabeçalho extra. Se a sua API só fala o protocolo da OpenAI, use `openai-compatible` (com `APP8N8_LLM_BASE_URL`) e não crie nada.

1. Crie `packages/llm/src/meu-provedor.ts`:

```ts
import { createChatClient } from "./chat";
import type { LlmProvider } from "./provider";

export const meuProvedor: LlmProvider = {
  id: "meu-provedor",
  defaultModel: "meu-modelo-rapido",
  usesKey: true,
  env: { apiKey: "MEU_PROVEDOR_API_KEY", baseURL: "MEU_PROVEDOR_BASE_URL" },
  isConfigured: (config) => config.apiKey !== undefined,
  create: (config, options = {}) =>
    createChatClient({
      apiKey: config.apiKey ?? "",
      baseURL: config.baseURL ?? "https://api.meu-provedor.example/v1",
      fetch: options.fetch,
      // Campos extras do corpo, por perfil de modelo.
      extras: ({ reasoning }) => (reasoning === "off" ? { thinking: false } : {}),
    }),
};
```

2. Registre o provedor em `PROVIDERS`, em `packages/llm/src/providers.ts`.
3. Escreva `packages/llm/src/__tests__/meu-provedor.test.ts` com um `fetch` falso. Use `openrouter.test.ts` como modelo. Nenhum teste usa a rede.
4. Acrescente as variáveis ao `.env.example`. O diálogo de Configurações lista o provedor novo sozinho, a partir de `PROVIDERS`, e guarda a chave e o modelo dele sem código a mais, e mostra o `defaultModel` dele como dica no campo Modelo.
5. Rode `pnpm typecheck`, `pnpm check` e `pnpm test`.

## API com protocolo próprio

`createChatClient` serve às APIs com o protocolo da OpenAI. Uma API com protocolo próprio não usa `createChatClient`. O provedor implementa `create` por conta própria e retorna um objeto com `complete`. O `anthropic.ts` é o exemplo: ele usa o SDK oficial, separa as mensagens `system` e pede o JSON só pelo prompt. O resto do guia vale igual.

## O que não muda

- O pipeline `explain` não importa `llm`. A regra `explain-not-llm` do dependency-cruiser garante isso.
- O servidor cria um cliente para a config atual e o passa ao resumo, às sugestões e aos títulos. Ele só cria outro quando a config muda.
- A config vem campo a campo: a variável de ambiente ganha do valor guardado pela tela, e o valor guardado ganha do padrão do provedor. A chave e o modelo guardados valem só para o provedor com que foram guardados.
- O id do provedor entra na impressão digital do cache. Trocar de provedor refaz os textos, mesmo com o mesmo nome de modelo.
