export interface Captured {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: Record<string, unknown>;
}

export function fakeFetch(status = 200, content = '{"summary":"ok"}') {
  const calls: Captured[] = [];
  const fetch = async (input: unknown, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    const payload =
      status === 200
        ? {
            id: "gen-1",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [
              {
                index: 0,
                finish_reason: "stop",
                message: { role: "assistant", content },
              },
            ],
          }
        : { error: { message: "boom" } };
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
