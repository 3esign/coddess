import type { NormalizedEntry } from '@coddess/shared';
import type { ChatMessage } from './provider/providerRouter.js';
import { chatStream } from './provider/providerRouter.js';
import { countTokens } from './budget.js';
import { ENABLE_MASKING } from '../config.js';

/**
 * Context compaction (pipeline cross-cutting component). Long tasks accumulate a
 * huge message history that eventually exceeds the model's context window. Rather
 * than fail, we summarize the OLDER turns into a compact synopsis while keeping
 * the system prompt and the most recent turns verbatim, then continue.
 * See docs/05-reasoning-pipeline.md §4 (context management).
 */

/** Total token estimate for a message array. */
export function messagesTokens(messages: ChatMessage[]): number {
  let n = 0;
  for (const m of messages) n += countTokens(m.content);
  return n;
}

export function needsCompaction(messages: ChatMessage[], threshold: number): boolean {
  return messagesTokens(messages) > threshold;
}

export interface CompactionSplit {
  system: ChatMessage | null;
  middle: ChatMessage[];
  recent: ChatMessage[];
}

/** Keep the leading system message + the last `keepRecent` messages; the rest is the summarizable middle. */
export function splitForCompaction(messages: ChatMessage[], keepRecent: number): CompactionSplit {
  const system = messages[0]?.role === 'system' ? messages[0] : null;
  const body = system ? messages.slice(1) : messages.slice();
  if (body.length <= keepRecent) return { system, middle: [], recent: body };
  const recent = body.slice(body.length - keepRecent);
  const middle = body.slice(0, body.length - keepRecent);
  return { system, middle, recent };
}

/** Reassemble a compacted message array: system + summary + recent turns. */
export function assembleCompacted(system: ChatMessage | null, summaryText: string, recent: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (system) out.push(system);
  out.push({
    role: 'user',
    content: `[CONVERSATION SUMMARY SO FAR — earlier turns were compacted to fit the context window. Treat this as authoritative background.]\n${summaryText}`,
  });
  out.push(...recent);
  return out;
}

export function maskObservations(content: string): string {
  return content.replace(/<observation([^>]*)>([\s\S]*?)<\/observation>/gi, (match, attrs, body) => {
    const trimmedBody = body.trim();
    if (trimmedBody.length > 100 && !trimmedBody.startsWith('[Output masked')) {
      return `<observation${attrs}>\n[Output masked to save context (${trimmedBody.length} chars)]\n</observation>`;
    }
    return match;
  });
}

const SUMMARY_SYSTEM = `You compact a software build conversation. Summarize the turns below into a terse, technical synopsis that a coding agent can rely on to continue the task without losing important state. Capture: decisions made, files created or changed and their purpose, commands run and their outcomes, unresolved problems, and what remains to do. No preamble, no fluff, no emojis. Output only the synopsis.`;

/**
 * Compact a message array if it exceeds `threshold`. Returns the same array
 * (possibly unchanged) plus whether compaction happened. The summarization is a
 * single cheap model call; on failure it falls back to dropping the oldest turns.
 */
export async function compactIfNeeded(
  messages: ChatMessage[],
  model: string,
  threshold: number,
  keepRecent: number,
  signal?: AbortSignal,
): Promise<{ messages: ChatMessage[]; compacted: boolean; noteText?: string; note?: NormalizedEntry }> {
  if (!needsCompaction(messages, threshold)) return { messages, compacted: false };

  let currentMessages = messages;
  let masked = false;

  if (ENABLE_MASKING) {
    const { system, middle, recent } = splitForCompaction(messages, keepRecent);
    if (middle.length > 0) {
      let maskedAny = false;
      const maskedMiddle = middle.map((m) => {
        if (m.role === 'user') {
          const maskedContent = maskObservations(m.content);
          if (maskedContent !== m.content) {
            maskedAny = true;
            return { ...m, content: maskedContent };
          }
        }
        return m;
      });

      if (maskedAny) {
        const assembled: ChatMessage[] = [];
        if (system) assembled.push(system);
        assembled.push(...maskedMiddle);
        assembled.push(...recent);
        currentMessages = assembled;
        masked = true;

        if (!needsCompaction(currentMessages, threshold)) {
          return {
            messages: currentMessages,
            compacted: true,
            noteText: 'Context optimized: older tool outputs were masked to save context.',
          };
        }
      }
    }
  }

  const { system, middle, recent } = splitForCompaction(currentMessages, keepRecent);
  if (middle.length === 0) {
    return {
      messages: currentMessages,
      compacted: masked,
      noteText: masked ? 'Context optimized: older tool outputs were masked to save context.' : undefined,
    };
  }

  const transcript = middle
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n')
    .slice(0, 40000);

  let summary = '';
  try {
    for await (const chunk of chatStream(model, [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: transcript },
    ], signal)) {
      summary += chunk;
    }
  } catch {
    summary = '';
  }

  if (!summary.trim()) {
    summary = `(Automatic summary unavailable. ${middle.length} earlier turns were dropped to fit the context window; rely on the current project files as the source of truth.)`;
  }

  return {
    messages: assembleCompacted(system, summary.trim(), recent),
    compacted: true,
    noteText: 'Context compacted: older turns were summarized to fit the model window.',
  };
}
