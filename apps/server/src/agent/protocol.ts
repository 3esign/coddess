/**
 * Model-agnostic action protocol.
 *
 * The system prompt instructs the model to emit exactly ONE of:
 *   <thinking> ... </thinking>            (optional, may precede a tool/final)
 *   <tool name="write_file">
 *     <arg name="path">index.html</arg>
 *     <arg name="content">...</arg>
 *   </tool>
 *   <final> summary </final>
 *
 * This parser is deliberately tolerant: models wrap tags in prose or code
 * fences, so we scan for the tags rather than requiring a clean document.
 * Keeping the protocol in text (not native tool-calling) means any local
 * Ollama model works, and the harness lives in the prompt — see systemPrompt.ts.
 */

export interface ToolAction {
  type: 'tool';
  tool: string;
  args: Record<string, string>;
}
export interface FinalAction {
  type: 'final';
  summary: string;
}
export interface NoAction {
  type: 'none';
}
export type ParsedAction = ToolAction | FinalAction | NoAction;

export function extractThinking(text: string): string | undefined {
  const m = /<thinking>([\s\S]*?)<\/thinking>/i.exec(text);
  return m ? m[1]!.trim() : undefined;
}

export function extractReasoning(text: string): string {
  return text
    .replace(/<tool\b[\s\S]*?<\/tool>/gi, '')
    .replace(/<final>[\s\S]*?<\/final>/gi, '')
    .replace(/<\/?thinking>/gi, '')
    .trim();
}

export function parseAction(text: string): ParsedAction {
  return parseActions(text)[0] || { type: 'none' };
}

export function parseActions(text: string): ParsedAction[] {
  // Pre-process common XML tag fusion typos: </arg name="content"> -> </arg><arg name="content">
  const cleanedText = text.replace(/<\/arg\s+name\s*=\s*/gi, '</arg><arg name=');

  const actions: ParsedAction[] = [];
  const regex = /(?:<tool\s+name\s*=\s*["']?([a-z_]+)["']?\s*>([\s\S]*?)(?:<\/tool>|(?=<tool|<final)|$))|(?:<final>([\s\S]*?)(?:<\/final>|(?=<tool|<final)|$))/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleanedText)) !== null) {
    if (match[1]) {
      const tool = match[1].toLowerCase();
      const inner = match[2] || '';
      const args: Record<string, string> = {};
      const argRe = /<arg\s+name\s*=\s*["']?([a-zA-Z_]+)["']?\s*>([\s\S]*?)<\/arg>/gi;
      let a: RegExpExecArray | null;
      let lastIndex = 0;
      while ((a = argRe.exec(inner)) !== null) {
        args[a[1]!] = decodeEntities(stripFence(a[2]!));
        lastIndex = argRe.lastIndex;
      }
      // Tolerate trailing unclosed arg
      const tail = /<arg\s+name\s*=\s*["']?([a-zA-Z_]+)["']?\s*>([\s\S]*)$/i.exec(inner.slice(lastIndex));
      if (tail && !(tail[1]! in args)) {
        const val = tail[2]!.replace(/<\/tool>[\s\S]*$/i, '');
        args[tail[1]!] = decodeEntities(stripFence(val));
      }
      actions.push({ type: 'tool', tool, args });
    } else if (match[3] !== undefined) {
      actions.push({ type: 'final', summary: match[3].trim() });
    }
  }

  if (actions.length === 0) {
    return [{ type: 'none' }];
  }
  return actions;
}

/** Strip a single wrapping ``` code fence if the model added one inside an arg. */
function stripFence(s: string): string {
  const t = s.replace(/^\s+|\s+$/g, '');
  const fence = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n```$/.exec(t);
  return fence ? fence[1]! : s.replace(/^\n/, '').replace(/\n$/, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
