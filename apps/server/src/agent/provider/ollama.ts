import { OLLAMA_HOST, NUM_CTX } from '../../config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OllamaError extends Error {}

/**
 * Stream a chat completion from Ollama's native /api/chat (NDJSON).
 * Yields text chunks as they arrive. Model-agnostic: we drive behaviour
 * through the system prompt, not native tool-calling.
 */
export async function* chatStream(
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: { temperature: 0.2, num_ctx: NUM_CTX },
      }),
      signal,
    });
  } catch (err) {
    throw new OllamaError(
      `Cannot reach Ollama at ${OLLAMA_HOST}. Is it running? (start it with "ollama serve"). Details: ${(err as Error).message}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) {
      throw new OllamaError(`Model "${model}" not found in Ollama. Pull it first: "ollama pull ${model}".`);
    }
    throw new OllamaError(`Ollama error ${res.status}: ${body}`);
  }
  if (!res.body) throw new OllamaError('Ollama returned an empty response body.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
        if (json.error) throw new OllamaError(json.error);
        const chunk = json.message?.content;
        if (chunk) yield chunk;
      } catch (e) {
        if (e instanceof OllamaError) throw e;
        // ignore malformed partial line
      }
    }
  }
}

/** List locally available models (for the model picker). */
export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name?: string }[] };
    return (data.models ?? []).map((m) => m.name ?? '').filter(Boolean);
  } catch {
    return [];
  }
}
