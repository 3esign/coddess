/**
 * Mid-run message queue. The user can send a message while an agent is working;
 * it is queued here and drained by the loop at the next safe checkpoint (between
 * steps), injected as a user message so the model reasons about it before
 * continuing. Keyed per project+chat.
 */
const queues = new Map<string, string[]>();

const key = (projectId: string, chatId: string) => `${projectId}::${chatId}`;

export function enqueueInjection(projectId: string, chatId: string, text: string): void {
  const t = (text || '').trim();
  if (!t) return;
  const k = key(projectId, chatId);
  const q = queues.get(k) ?? [];
  q.push(t);
  queues.set(k, q);
}

/** Return and clear any queued messages for this project+chat. */
export function drainInjections(projectId: string, chatId: string): string[] {
  const k = key(projectId, chatId);
  const q = queues.get(k);
  if (!q || q.length === 0) return [];
  queues.delete(k);
  return q;
}
