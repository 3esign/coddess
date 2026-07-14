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
  // <final> wins if the model declares it is done.
  const finalMatch = /<final>([\s\S]*?)<\/final>/i.exec(text);
  const toolMatch = /<tool\s+name\s*=\s*["']?([a-z_]+)["']?\s*>([\s\S]*?)<\/tool>/i.exec(text);

  // If both appear, honour whichever comes first in the stream.
  if (finalMatch && (!toolMatch || finalMatch.index < toolMatch.index)) {
    return { type: 'final', summary: finalMatch[1]!.trim() };
  }

  if (toolMatch) {
    const tool = toolMatch[1]!.toLowerCase();
    const inner = toolMatch[2]!;
    const args: Record<string, string> = {};
    const argRe = /<arg\s+name\s*=\s*["']?([a-zA-Z_]+)["']?\s*>([\s\S]*?)<\/arg>/gi;
    let a: RegExpExecArray | null;
    while ((a = argRe.exec(inner)) !== null) {
      args[a[1]!] = decodeEntities(stripFence(a[2]!));
    }
    return { type: 'tool', tool, args };
  }

  return { type: 'none' };
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
