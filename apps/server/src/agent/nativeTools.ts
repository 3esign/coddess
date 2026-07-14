import type { ChatMessage } from './provider/providerRouter.js';
import { ProviderError } from './provider/providerRouter.js';
import { getSettings } from '../settings.js';
import { isFrontierModel } from './modelProfile.js';

/**
 * Native (structured) tool-calling for providers that support it — a more
 * reliable alternative to the text/XML protocol on frontier models. The XML
 * protocol remains the universal default (and the Ollama path); this activates
 * only when CODDESS_NATIVE_TOOLS=1 and the selected provider supports tools.
 * See docs/05-reasoning-pipeline.md §7.
 */

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}
export interface ToolTurn {
  text: string;
  call: ToolCall | null;
}

interface ToolDef {
  name: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

/** The Coddess tool set as provider-agnostic definitions (mirrors tools.ts + a finish tool). */
export const CODDESS_TOOLS: ToolDef[] = [
  { name: 'list_dir', description: 'List the contents of a directory (project-relative, or an absolute path inside a linked context folder).', properties: { path: { type: 'string', description: 'Directory path. Default "."' } }, required: [] },
  { name: 'read_file', description: 'Read a file (project-relative, or absolute inside a linked context folder).', properties: { path: { type: 'string', description: 'File path.' } }, required: ['path'] },
  { name: 'search_code', description: 'Regex grep across the project (or a linked folder). Returns file:line matches.', properties: { query: { type: 'string', description: 'Regex to search for.' }, path: { type: 'string', description: 'Optional subdirectory.' }, glob: { type: 'string', description: 'Optional extension filter, e.g. "ts,tsx".' } }, required: ['query'] },
  { name: 'write_file', description: 'Create or overwrite a whole file with full contents.', properties: { path: { type: 'string', description: 'File path.' }, content: { type: 'string', description: 'Full file contents.' } }, required: ['path', 'content'] },
  { name: 'edit_file', description: 'Replace an exact substring in an existing file.', properties: { path: { type: 'string', description: 'File path.' }, old: { type: 'string', description: 'Exact text to find.' }, new: { type: 'string', description: 'Replacement text.' }, replace_all: { type: 'string', description: '"true" to replace all occurrences.' } }, required: ['path', 'old'] },
  { name: 'git', description: 'Run a git subcommand (init, commit, remote, push, pull, clone, status, log).', properties: { command: { type: 'string', description: 'The git subcommand, e.g. "commit -m \'msg\'".' } }, required: ['command'] },
  { name: 'run', description: 'Run a shell command in the project root (install deps, build, run tests).', properties: { command: { type: 'string', description: 'Shell command.' } }, required: ['command'] },
  { name: 'browser_eval', description: 'Launch a headless browser to load and test an HTML page in the project, checking console errors and executing custom evaluation JS.', properties: { path: { type: 'string', description: 'Path to the HTML file (project-relative).' }, js: { type: 'string', description: 'Optional JS code to evaluate in the browser context.' } }, required: ['path'] },
  { name: 'finish', description: 'Call when the task is fully done and verified.', properties: { summary: { type: 'string', description: 'Concise summary of what was built and how to run it.' } }, required: ['summary'] },
];

export function toOpenAITools(): unknown[] {
  return CODDESS_TOOLS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.properties, required: t.required } },
  }));
}

export function toAnthropicTools(): unknown[] {
  return CODDESS_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: { type: 'object', properties: t.properties, required: t.required },
  }));
}

/** Whether the model's provider supports native tool-calling (everything except local Ollama). */
export function providerSupportsNativeTools(model: string): boolean {
  // Single source of truth shared with the tier classifier so the two never drift.
  return isFrontierModel(model);
}

/** Parse an OpenAI-format chat completion into text + first tool call. Exposed for tests. */
export function parseOpenAIResponse(json: any): ToolTurn {
  const msg = json?.choices?.[0]?.message ?? {};
  const text = typeof msg.content === 'string' ? msg.content : '';
  const tc = Array.isArray(msg.tool_calls) ? msg.tool_calls[0] : null;
  if (tc?.function?.name) {
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments || '{}'); } catch { args = {}; }
    return { text, call: { name: tc.function.name, args } };
  }
  return { text, call: null };
}

/** Parse an Anthropic messages response into text + first tool_use. Exposed for tests. */
export function parseAnthropicResponse(json: any): ToolTurn {
  const blocks = Array.isArray(json?.content) ? json.content : [];
  const text = blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim();
  const use = blocks.find((b: any) => b?.type === 'tool_use');
  if (use?.name) return { text, call: { name: use.name, args: (use.input as Record<string, unknown>) || {} } };
  return { text, call: null };
}

function openAiEndpoint(model: string): { url: string; key: string; real: string; headers?: Record<string, string> } {
  const s = getSettings();
  if (model.startsWith('openrouter/')) return { url: 'https://openrouter.ai/api/v1/chat/completions', key: s.apiKeys.openrouter || '', real: model.slice('openrouter/'.length), headers: { 'HTTP-Referer': 'https://github.com/coddess/coddess', 'X-Title': 'Coddess' } };
  if (model.startsWith('gemini/') || model.startsWith('gemini-')) return { url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: s.apiKeys.gemini || '', real: model.replace(/^gemini\//, '') };
  if (model.startsWith('deepseek/') || model.startsWith('deepseek-')) return { url: 'https://api.deepseek.com/chat/completions', key: s.apiKeys.deepseek || '', real: model.replace(/^deepseek\//, '') };
  if (model.startsWith('kimi/') || model.startsWith('moonshot-')) return { url: 'https://api.moonshot.cn/v1/chat/completions', key: s.apiKeys.kimi || '', real: model.replace(/^kimi\//, '') };
  if (model.startsWith('custom/')) {
    const parts = model.split('/');
    const prov = s.customProviders.find((p) => p.id === parts[1]);
    if (!prov) throw new ProviderError(`Custom provider "${parts[1]}" not found`);
    const url = prov.baseUrl.endsWith('/chat/completions') ? prov.baseUrl : `${prov.baseUrl}/chat/completions`;
    return { url, key: prov.apiKey || '', real: parts.slice(2).join('/') };
  }
  throw new ProviderError(`No native tool endpoint for ${model}`);
}

/** One non-streaming turn with native tools. Returns assistant text + at most one tool call. */
export async function chatWithTools(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<ToolTurn> {
  if (model.startsWith('anthropic/') || model.startsWith('claude-')) {
    const s = getSettings();
    const key = s.apiKeys.anthropic || '';
    if (!key) throw new ProviderError('Anthropic API key is not configured.');
    const real = model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model;
    const system = messages.find((m) => m.role === 'system')?.content || '';
    const conv = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: real, system: system || undefined, messages: conv, tools: toAnthropicTools(), max_tokens: 4000 }),
      signal,
    });
    if (!res.ok) throw new ProviderError(`Anthropic tools error ${res.status}: ${await res.text().catch(() => '')}`);
    return parseAnthropicResponse(await res.json());
  }

  const ep = openAiEndpoint(model);
  if (!ep.key && !model.startsWith('custom/')) throw new ProviderError(`API key for ${model} is not configured.`);
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ep.key ? { Authorization: `Bearer ${ep.key}` } : {}), ...(ep.headers || {}) },
    body: JSON.stringify({ model: ep.real, messages, tools: toOpenAITools(), tool_choice: 'auto', temperature: 0.2 }),
    signal,
  });
  if (!res.ok) throw new ProviderError(`Native tools error ${res.status} from ${ep.url}: ${await res.text().catch(() => '')}`);
  return parseOpenAIResponse(await res.json());
}
