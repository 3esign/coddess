import { OLLAMA_HOST, NUM_CTX } from '../../config.js';
import { getSettings } from '../../settings.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Per-call generation options. All optional and backward-compatible:
 *  - stop:   stop sequences (e.g. ["</tool>","</final>"]) so the model can't run
 *            past its single action, emit a second action, or hallucinate results.
 *  - format: Ollama structured-output constraint ('json' or a JSON Schema object)
 *            for the JSON stages (intent/plan/knowledge) — a hard well-formedness
 *            guarantee on weak local models. Ignored by hosted providers here.
 *  - numCtx: override the Ollama context window (defaults to config NUM_CTX).
 */
export interface ChatOptions {
  stop?: string[];
  format?: unknown;
  numCtx?: number;
}

export class ProviderError extends Error {}

/**
 * Stream a chat completion from the selected model & provider.
 * Routes based on prefix, fetching keys from settings.
 */
export async function* chatStream(
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const settings = getSettings();

  // 1. OpenRouter
  if (model.startsWith('openrouter/')) {
    const realModel = model.replace('openrouter/', '');
    const apiKey = settings.apiKeys.openrouter;
    if (!apiKey) throw new ProviderError('OpenRouter API key is not configured.');
    yield* streamOpenAICompatible(
      'https://openrouter.ai/api/v1/chat/completions',
      apiKey,
      realModel,
      messages,
      signal,
      {
        'HTTP-Referer': 'https://github.com/coddess/coddess',
        'X-Title': 'Coddess',
      },
      opts,
    );
    return;
  }

  // 2. Anthropic (Claude)
  if (model.startsWith('anthropic/') || model.startsWith('claude-')) {
    const realModel = model.startsWith('anthropic/') ? model.replace('anthropic/', '') : model;
    const apiKey = settings.apiKeys.anthropic;
    if (!apiKey) throw new ProviderError('Anthropic API key is not configured.');
    yield* streamAnthropic(apiKey, realModel, messages, signal, opts);
    return;
  }

  // 3. Gemini (Google) via OpenAI-compatible endpoint
  if (model.startsWith('gemini/') || model.startsWith('gemini-')) {
    const realModel = model.startsWith('gemini/') ? model.replace('gemini/', '') : model;
    const apiKey = settings.apiKeys.gemini;
    if (!apiKey) throw new ProviderError('Gemini API key is not configured.');
    // Gemini OpenAI compatible path
    yield* streamOpenAICompatible(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      apiKey,
      realModel,
      messages,
      signal,
      {},
      opts,
    );
    return;
  }

  // 4. Kimi (Moonshot)
  if (model.startsWith('kimi/') || model.startsWith('moonshot-')) {
    const realModel = model.startsWith('kimi/') ? model.replace('kimi/', '') : model;
    const apiKey = settings.apiKeys.kimi;
    if (!apiKey) throw new ProviderError('Kimi API key is not configured.');
    yield* streamOpenAICompatible(
      'https://api.moonshot.cn/v1/chat/completions',
      apiKey,
      realModel,
      messages,
      signal,
      {},
      opts,
    );
    return;
  }

  // 5. DeepSeek
  if (model.startsWith('deepseek/') || model.startsWith('deepseek-')) {
    const realModel = model.startsWith('deepseek/') ? model.replace('deepseek/', '') : model;
    const apiKey = settings.apiKeys.deepseek;
    if (!apiKey) throw new ProviderError('DeepSeek API key is not configured.');
    yield* streamOpenAICompatible(
      'https://api.deepseek.com/chat/completions',
      apiKey,
      realModel,
      messages,
      signal,
      {},
      opts,
    );
    return;
  }

  // 6. Custom Provider
  if (model.startsWith('custom/')) {
    const parts = model.split('/'); // custom/providerId/modelName
    if (parts.length < 3) throw new ProviderError('Invalid custom model path');
    const providerId = parts[1];
    const realModel = parts.slice(2).join('/');
    const provider = settings.customProviders.find(p => p.id === providerId);
    if (!provider) throw new ProviderError(`Custom provider with ID "${providerId}" not found`);
    yield* streamOpenAICompatible(
      provider.baseUrl.endsWith('/chat/completions') ? provider.baseUrl : `${provider.baseUrl}/chat/completions`,
      provider.apiKey || '',
      realModel,
      messages,
      signal,
      {},
      opts,
    );
    return;
  }

  // 7. Fallback to local Ollama
  yield* streamOllama(model, messages, signal, opts);
}

/** Stream Ollama native chat endpoint */
async function* streamOllama(
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const options: Record<string, unknown> = {
    temperature: 0.2,
    // Without num_ctx Ollama silently truncates to its small default (~4K),
    // cutting the system prompt + history. Request the real window explicitly.
    num_ctx: opts.numCtx ?? NUM_CTX,
  };
  if (opts.stop && opts.stop.length) options.stop = opts.stop;

  const body: Record<string, unknown> = { model, messages, stream: true, options };
  if (opts.format !== undefined) body.format = opts.format;

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ProviderError(
      `Cannot reach Ollama at ${OLLAMA_HOST}. Is it running? Details: ${(err as Error).message}`
    );
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    if (res.status === 404) {
      throw new ProviderError(`Model "${model}" not found in Ollama. Pull it first: "ollama pull ${model}".`);
    }
    throw new ProviderError(`Ollama error ${res.status}: ${errBody}`);
  }
  if (!res.body) throw new ProviderError('Ollama returned an empty response body.');

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
        if (json.error) throw new ProviderError(json.error);
        const chunk = json.message?.content;
        if (chunk) yield chunk;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
      }
    }
  }
}

/** Stream OpenAI-compatible completions */
async function* streamOpenAICompatible(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: 0.2,
  };
  if (opts.stop && opts.stop.length) body.stop = opts.stop;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ProviderError(`Failed to connect to API endpoint at ${url}. Details: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new ProviderError(`API error ${res.status} from ${url}: ${errBody}`);
  }
  if (!res.body) throw new ProviderError('API returned an empty response body.');

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

      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') break;
        try {
          const json = JSON.parse(dataStr) as { choices?: { delta?: { content?: string } }[] };
          const chunk = json.choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch {
          // Ignore json parsing errors for incomplete stream lines
        }
      }
    }
  }
}

/** Stream Anthropic messages endpoint */
async function* streamAnthropic(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const systemMessage = messages.find(m => m.role === 'system');
  const system = systemMessage ? systemMessage.content : '';
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

  const body: Record<string, unknown> = {
    model,
    messages: anthropicMessages,
    system: system || undefined,
    max_tokens: 4000,
    stream: true,
  };
  if (opts.stop && opts.stop.length) body.stop_sequences = opts.stop;

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ProviderError(`Failed to connect to Anthropic API. Details: ${(err as Error).message}`);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new ProviderError(`Anthropic API error ${res.status}: ${errBody}`);
  }
  if (!res.body) throw new ProviderError('Anthropic returned an empty response body.');

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

      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6).trim();
        try {
          const json = JSON.parse(dataStr) as { type: string; delta?: { text?: string } };
          if (json.type === 'content_block_delta' && json.delta?.text) {
            yield json.delta.text;
          }
        } catch {
          // ignore
        }
      }
    }
  }
}
