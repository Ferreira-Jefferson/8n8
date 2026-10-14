export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Uma chamada de modelo: mensagens entram, texto sai. Todo provedor implementa este contrato. */
export interface LlmClient {
  complete(req: {
    model: string;
    messages: ChatMessage[];
    json: "native" | "prompt";
  }): Promise<string>;
}
